/**
 * Reconcile the stored catalogue against the supplier, product by product.
 *
 *   node utils/syncSupplier.js                       # DRY RUN — reports, changes nothing
 *   node utils/syncSupplier.js --apply               # write stock + delete removed products
 *   node utils/syncSupplier.js --apply --no-delete   # stock only, delete nothing
 *   node utils/syncSupplier.js --apply --titles      # also refresh name/description
 *   node utils/syncSupplier.js --limit=200           # sample the first 200 (for a quick check)
 *   node utils/syncSupplier.js --apply --force       # proceed past the mass-deletion guard
 *
 * ─── How this relates to the crawl ─────────────────────────────────────────────
 *
 * utils/scrapeNow.js now refreshes availability, title and description for every
 * product it sees as part of the normal crawl (hooks.refreshExisting), so routine
 * upkeep does not need this script. What stays unique to it:
 *
 *   - it covers the WHOLE stored catalogue, not just products the crawl reached.
 *     A crawl that comes up short of the category tree — the last one visited
 *     695 of 777 nodes — silently leaves the products under the missed nodes
 *     unrefreshed. This walks the collection itself, so coverage does not depend
 *     on the category tree.
 *   - it is the only thing that DELETES products the supplier removed, behind the
 *     guards below. The crawl only zeroes their stock.
 *
 * ─── What this fixes ────────────────────────────────────────────────────────────
 *
 * STOCK. The crawler reads stock from the category listing pages, out of a
 * `font[color="#009900"]` element holding "N in stock". That element is gone — the
 * listing pages carry no `font` tag at all any more and no stock figure in any
 * form — so every product the crawl writes lands at stock 0. On top of that, a
 * product already in the store is only ever re-tagged by a rescrape (`tagOnly`),
 * which by design writes nothing but categoryTags, so those zeros were never
 * revisited either. 1693 of 7110 live products were showing out-of-stock; spot
 * checks against the supplier found real quantities of 1129, 169 and 60 among
 * them. The quantity now exists in exactly one place, each product's own detail
 * page ("Quantity in Stock:1129" / "Quantity in Stock:(Out of Stock)"), so this
 * walks those pages.
 *
 * REMOVED PRODUCTS. Nothing ever deleted a product the supplier had dropped, so
 * the store kept listing items that no longer exist (and whose images 404). A
 * removed product code serves a real not-found page, which is what identifies it.
 *
 * ─── What this deliberately never touches ───────────────────────────────────────
 *
 * PRICE. Not price, not originalPrice, not under any flag. The store's prices are
 * a retail markup the admin built by hand over ~7000 products — live spot checks
 * show the supplier at €8.45 where the store is at €20 — so this file has no code
 * path that writes either field. Neither does a rescrape any more: see the
 * write-once note in scrapePersistence.js.
 *
 * ─── Deleting safely ────────────────────────────────────────────────────────────
 *
 * Deletion is irreversible, so it is gated seven ways:
 *   1. A product only counts as removed on a positive not-found signature — the
 *      "page cannot be found" title, no price element, AND a genuine HTTP 404. A
 *      timeout, a network error, a logged-out redirect, or that same template
 *      served with a 403/429/5xx is "unknown", never "removed". The status check
 *      matters because 7000 sequential requests from one IP invite exactly the
 *      anti-bot and rate-limit responses that reuse a not-found page.
 *   2. Every candidate is re-checked on a second navigation, and only a product
 *      that fails twice is deleted. That pass recycles its tab, so it cannot
 *      quietly stop partway.
 *   3. Aborts if confirmed removals exceed MAX_DELETE_FRACTION of the pages
 *      actually read.
 *   4. Aborts if FIRST-PASS candidates exceed that fraction, even when pass 2
 *      whittled them down — a block that lifts halfway through leaves a small
 *      confirmed count that would otherwise sail under gate 3.
 *   5. Aborts if more than MAX_UNKNOWN_FRACTION of pages were unreadable, or if
 *      re-verification did not cover every candidate.
 *   6. --limit runs never delete at all: a sample cannot establish that a product
 *      is absent from the catalogue. --force cannot cross ABSOLUTE_DELETE_CEILING.
 *   7. Full documents are written to a timestamped JSON backup before removal, so
 *      a wrong call can be restored.
 *
 * No DeletedProduct tombstone is written. Tombstones exist to make an ADMIN's
 * delete permanent against future scrapes; a product the supplier pulled and later
 * restocks should be free to come back on its own.
 */
import dotenv from "dotenv"
dotenv.config()

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import mongoose from "mongoose"
import { Product } from "../models/Product.js"
import { createBrowserKeeper, isLoggedOutUrl, login, readProductPage } from "./srapper.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Overridable: the ceiling is free RAM, not the supplier. Each tab is a Chrome
// renderer, and 8 of them died repeatedly on a machine with ~3GB free.
//   SYNC_CONCURRENCY=3 node utils/syncSupplier.js --apply
const CONCURRENCY = (() => {
    const n = Number(process.env.SYNC_CONCURRENCY)
    return Number.isInteger(n) && n > 0 ? n : 8
})()
// Tabs leak memory across hundreds of navigations; the crawler hit renderer
// crashes without this and so does a 7000-page pass.
const RECYCLE_EVERY = 150
const WRITE_CHUNK = 500
const MAX_DELETE_FRACTION = 0.15
// A run that could not read a meaningful share of the catalogue has not earned
// the right to decide what is missing from it.
const MAX_UNKNOWN_FRACTION = 0.05
// A hard stop that --force cannot cross, so no single invocation can empty the
// collection however the flags are combined.
const ABSOLUTE_DELETE_CEILING = 500
const NAV_TIMEOUT = 25000

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const noDelete = args.includes("--no-delete")
const withTitles = args.includes("--titles")
const force = args.includes("--force")
const limit = Number(args.find((a) => a.startsWith("--limit="))?.slice("--limit=".length) ?? 0)

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "0%")

// ── Read one product's page, with a re-login retry ────────────────────────────
// Returns { status: "ok" | "gone" | "unknown", stock, name, description }.
// "unknown" is the safe bucket: it means we learned nothing about this product,
// so nothing about it gets written and it is never a deletion candidate.
async function inspect(page, product) {
    // 3 attempts, not 2: a re-login consumes one, and it must not be able to
    // exhaust the budget on its own and turn a live product into "unknown".
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await page.goto(product.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT })

            // A dropped session redirects to the login form. That page is neither
            // the product nor a not-found page, and treating it as either would be
            // catastrophic at scale — re-authenticate and read the product again.
            if (isLoggedOutUrl(page.url())) {
                await login(page)
                continue
            }

            const info = await readProductPage(page)
            const status = resp ? resp.status() : 0

            if (info.gone) {
                // The HTTP status is the corroboration that makes this safe. A
                // removed product code serves a genuine 404 (verified with curl,
                // independently of this browser). Anything else that happens to
                // render the same IIS template — a 403 from a WAF or anti-bot rule,
                // a 429, a 5xx error page, an edge cache — is NOT evidence of
                // removal, and at 7000 sequential requests from one IP those are
                // exactly the responses to expect. They become "unknown", which
                // never deletes.
                if (status === 404) return { status: "gone" }
                return { status: "unknown", error: `not-found page served with HTTP ${status}` }
            }
            // Cloudflare challenge or another non-product page — nothing on it is
            // this product's stock or title.
            if (info.blocked) return { status: "unknown", error: "blocked / not a product page" }
            return { status: "ok", stock: info.stock, name: info.name, description: info.description }
        } catch (err) {
            if (attempt === 2) return { status: "unknown", error: err.message }
        }
    }
    return { status: "unknown", error: "exhausted retries" }
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n${apply ? "APPLY" : "DRY RUN"} — supplier reconciliation`)
console.log(`   stock refresh : yes`)
console.log(`   titles/descs  : ${withTitles ? "yes" : "no (pass --titles to enable)"}`)
console.log(`   delete removed: ${noDelete ? "no (--no-delete)" : "yes"}`)
console.log(`   prices        : never written\n`)

await mongoose.connect(process.env.MONGO_URI)
console.log(`MongoDB connected: ${mongoose.connection.host}`)

const query = Product.find({ url: { $nin: ["", null] } }, { id: 1, name: 1, url: 1, stock: 1, description: 1 }).lean()
if (limit > 0) query.limit(limit)
const products = await query
const catalogueSize = await Product.countDocuments()
console.log(`${catalogueSize} products in store, ${products.length} with a URL to check\n`)

if (!products.length) {
    console.log("nothing to check.")
    await mongoose.disconnect()
    process.exit(0)
}

// Chrome dies partway through long passes over this supplier: a 7035-product
// run died at ~1400 and recorded the next 1000 products as "unreadable" before
// the exception took the whole run down. The keeper relaunches and re-logs in.
const keeper = createBrowserKeeper()
await keeper.ensure()

// Accumulated results
const stockChanges = [] // { id, from, to }
const titleChanges = [] // { id, name, description }
const goneCandidates = [] // product docs that looked removed
const unknown = [] // { id, error } — nothing written for these
let checked = 0
let unchangedStock = 0

let exitCode = 0
try {
    // ── Pass 1: read every product page ──────────────────────────────────────
    let cursor = 0
    async function worker(slot) {
        let page = await keeper.page()
        let sinceRecycle = 0

        while (cursor < products.length) {
            const p = products[cursor++]
            let res
            try {
                res = await inspect(page, p)
            } catch (err) {
                // inspect() already swallows page-level errors, so reaching here
                // means the tab or the browser itself is unusable. Replace it
                // (relaunching Chrome if that is what it takes) and retry this one
                // product before giving up on it — otherwise a single death turns
                // the rest of the queue into thousands of unreadable entries, which
                // is exactly how two runs were lost.
                try {
                    page = await keeper.page()
                    sinceRecycle = 0
                    res = await inspect(page, p)
                } catch (fatal) {
                    unknown.push({
                        id: p.id,
                        error: "browser unrecoverable: " + (fatal.message || "").slice(0, 60),
                    })
                    checked++
                    console.warn("  worker " + slot + " stopping — " + (fatal.message || "").slice(0, 90))
                    return slot
                }
            }

            if (res.status === "gone") {
                goneCandidates.push(p)
            } else if (res.status === "unknown") {
                unknown.push({ id: p.id, error: (res.error || "").slice(0, 80) })
            } else {
                if (typeof res.stock === "number" && res.stock !== p.stock) {
                    stockChanges.push({ id: p.id, from: p.stock ?? null, to: res.stock, name: p.name })
                } else if (typeof res.stock === "number") {
                    unchangedStock++
                }
                if (withTitles && res.name && res.description) {
                    const short = res.description.length > 200 ? `${res.description.slice(0, 200).trim()}…` : res.description
                    titleChanges.push({ id: p.id, name: res.name, description: short, longDescription: res.description })
                }
            }

            checked++
            sinceRecycle++
            if (checked % 200 === 0 || checked === products.length) {
                console.log(
                    `  checked ${checked}/${products.length} — ${stockChanges.length} stock changes, ` +
                        `${goneCandidates.length} look removed, ${unknown.length} unreadable`
                )
            }
            if (sinceRecycle >= RECYCLE_EVERY && cursor < products.length) {
                try {
                    await page.close()
                } catch {
                    // discarding it anyway
                }
                page = await keeper.page()
                sinceRecycle = 0
            }
        }
        try {
            await page.close()
        } catch {
            // browser.close() cleans up regardless
        }
        return slot
    }

    console.log(`Reading ${products.length} product pages across ${CONCURRENCY} tabs…`)
    // allSettled, not all: a worker that dies must not throw away what the
    // others already read. An earlier run lost 194 verified stock changes
    // because one worker could not open a tab. Anything not read shows up as
    // unreadable, and the unknown-fraction guard refuses to delete on a degraded
    // run — so keeping partial progress is safe.
    const passOne = await Promise.allSettled(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)))
    const deadWorkers = passOne.filter((r) => r.status === "rejected").length
    if (deadWorkers) console.warn("\n⚠ " + deadWorkers + " of " + CONCURRENCY + " workers died during pass 1")
    if (checked < products.length) {
        console.warn("⚠ only " + checked + " of " + products.length + " products were read — the rest were not reached")
    }

    // ── Pass 2: re-verify every deletion candidate ───────────────────────────
    // One bad navigation must not be able to delete a product, so each candidate
    // has to produce the not-found signature a second time on a fresh page.
    const confirmedGone = []
    const reprieved = []
    let verifyCompleted = 0
    if (goneCandidates.length) {
        console.log(`\nRe-verifying ${goneCandidates.length} removal candidates…`)
        let vPage = await keeper.page()
        let sinceRecycle = 0
        for (const p of goneCandidates) {
            const again = await inspect(vPage, p)
            if (again.status === "gone") confirmedGone.push(p)
            else reprieved.push({ id: p.id, secondLook: again.status })
            verifyCompleted++
            // This pass can be thousands of navigations on one tab, which is the
            // exact workload RECYCLE_EVERY exists for elsewhere in this file. An
            // un-recycled tab dying partway would silently end verification.
            if (++sinceRecycle >= RECYCLE_EVERY && verifyCompleted < goneCandidates.length) {
                try {
                    await vPage.close()
                } catch {
                    // discarding it anyway
                }
                vPage = await keeper.page()
                sinceRecycle = 0
            }
        }
        await vPage.close().catch(() => {})
        console.log(`   confirmed removed: ${confirmedGone.length}, reprieved on second look: ${reprieved.length}`)
    }

    // ── Report ───────────────────────────────────────────────────────────────
    const nowStock0 = stockChanges.filter((c) => c.to === 0).length
    const backInStock = stockChanges.filter((c) => (c.from === 0 || c.from == null) && c.to > 0)

    console.log(`\n──────── RESULT ────────`)
    console.log(`checked                : ${checked}`)
    console.log(`stock unchanged        : ${unchangedStock}`)
    console.log(`stock to update        : ${stockChanges.length}`)
    console.log(`  ↳ back IN stock      : ${backInStock.length}   <- were showing out-of-stock, supplier has them`)
    console.log(`  ↳ now out of stock   : ${nowStock0}`)
    console.log(`removed at supplier    : ${confirmedGone.length} (${pct(confirmedGone.length, checked)} of checked)`)
    console.log(`unreadable (untouched) : ${unknown.length}`)
    if (withTitles) console.log(`titles/descs to refresh: ${titleChanges.length}`)
    console.log(`prices to change       : 0  (never written)`)

    if (backInStock.length) {
        console.log(`\nsample — products your site called out-of-stock that the supplier has:`)
        for (const c of backInStock.sort((a, b) => b.to - a.to).slice(0, 12)) {
            console.log(`   ${String(c.to).padStart(5)} units  ${(c.name || "").slice(0, 58)}`)
        }
    }
    if (confirmedGone.length) {
        console.log(`\nsample — no longer on the supplier site:`)
        for (const p of confirmedGone.slice(0, 12)) console.log(`   ${p.id}  ${(p.name || "").slice(0, 58)}`)
    }

    // ── Write ────────────────────────────────────────────────────────────────
    if (!apply) {
        console.log(`\nDRY RUN — nothing was written. Re-run with --apply to:`)
        console.log(`   • update stock on ${stockChanges.length} products`)
        if (withTitles) console.log(`   • refresh name/description on ${titleChanges.length} products`)
        if (noDelete) {
            console.log(`   • delete nothing (--no-delete); ${confirmedGone.length} removed products would stay`)
        } else if (limit > 0) {
            console.log(`   • delete NOTHING — a --limit sample is never allowed to delete (re-run without --limit)`)
        } else {
            console.log(`   • delete ${confirmedGone.length} products the supplier removed`)
        }
        console.log(`   • (prices stay exactly as they are)`)
    } else {
        // Stock, in chunks. Only ever the one field.
        if (stockChanges.length) {
            console.log(`\nWriting stock for ${stockChanges.length} products…`)
            for (let i = 0; i < stockChanges.length; i += WRITE_CHUNK) {
                const slice = stockChanges.slice(i, i + WRITE_CHUNK)
                await Product.bulkWrite(
                    // Stock the admin set by hand (stockOverridden) is left alone.
                    slice.map((c) => ({
                        updateOne: { filter: { id: c.id, stockOverridden: { $ne: true } }, update: { $set: { stock: c.to } } },
                    })),
                    { ordered: false }
                )
                console.log(`   ${Math.min(i + WRITE_CHUNK, stockChanges.length)}/${stockChanges.length}`)
            }
            console.log(`✅ stock updated`)
        }

        if (withTitles && titleChanges.length) {
            console.log(`\nWriting name/description for ${titleChanges.length} products…`)
            for (let i = 0; i < titleChanges.length; i += WRITE_CHUNK) {
                const slice = titleChanges.slice(i, i + WRITE_CHUNK)
                await Product.bulkWrite(
                    slice.map((c) => ({
                        updateOne: {
                            filter: { id: c.id },
                            update: { $set: { name: c.name, description: c.description, longDescription: c.longDescription } },
                        },
                    })),
                    { ordered: false }
                )
            }
            console.log(`✅ titles/descriptions updated`)
        }

        if (noDelete) {
            console.log(`\nskipping deletion (--no-delete): ${confirmedGone.length} removed products left in place`)
        } else if (!confirmedGone.length) {
            console.log(`\nnothing to delete`)
        } else {
            // Four independent brakes. Each answers a different way for the run to
            // be untrustworthy, and any one of them stops the deletion step while
            // still leaving the stock updates above applied.
            const readable = checked - unknown.length
            const blocks = []

            // 1. How much we are about to delete.
            if (confirmedGone.length / Math.max(readable, 1) > MAX_DELETE_FRACTION) {
                blocks.push(
                    `${confirmedGone.length} of ${readable} readable products (${pct(confirmedGone.length, readable)}) ` +
                        `confirmed removed, over the ${(MAX_DELETE_FRACTION * 100).toFixed(0)}% guard`
                )
            }

            // 2. How much LOOKED removed on the first pass. This is the real outage
            //    signal, and it is not visible in the confirmed count: a block that
            //    lifts partway leaves a modest confirmed number that sails under
            //    brake 1 while pass 1 was screaming.
            if (goneCandidates.length / Math.max(readable, 1) > MAX_DELETE_FRACTION) {
                blocks.push(
                    `${goneCandidates.length} products (${pct(goneCandidates.length, readable)}) served a not-found page ` +
                        `on the first pass — that is an outage or a block, not a purge`
                )
            }

            // 3. Whether the run could actually read the supplier at all.
            if (unknown.length / Math.max(checked, 1) > MAX_UNKNOWN_FRACTION) {
                blocks.push(
                    `${unknown.length} of ${checked} pages (${pct(unknown.length, checked)}) were unreadable — ` +
                        `a degraded run must not decide what to delete`
                )
            }

            // 4. Whether verification actually finished.
            if (verifyCompleted !== goneCandidates.length) {
                blocks.push(
                    `re-verification covered only ${verifyCompleted} of ${goneCandidates.length} candidates ` +
                        `(the pass did not complete)`
                )
            }

            // A sampled run knows nothing about the rest of the catalogue, so it is
            // never allowed to delete — not even with --force.
            if (limit > 0) {
                console.error(
                    `\n⛔ SKIPPING DELETION: this was a --limit=${limit} sample of ${catalogueSize} products.`
                )
                console.error(`   A sample cannot establish that a product is gone from the catalogue.`)
                console.error(`   Stock changes above were still applied. Re-run without --limit to delete.`)
                exitCode = 2
            } else if (blocks.length && !force) {
                console.error(`\n⛔ ABORTING DELETION — ${blocks.length} safety check(s) failed:`)
                for (const b of blocks) console.error(`   • ${b}`)
                console.error(`   Nothing was deleted. Stock changes above were still applied.`)
                console.error(`   Re-run with --force ONLY if you have confirmed these products really are gone.`)
                exitCode = 2
            } else if (blocks.length && force && confirmedGone.length > ABSOLUTE_DELETE_CEILING) {
                // --force is an override for a judgement call, not a licence to
                // empty the collection in one command.
                console.error(
                    `\n⛔ REFUSING even with --force: ${confirmedGone.length} deletions exceeds the absolute ` +
                        `ceiling of ${ABSOLUTE_DELETE_CEILING} for a single run.`
                )
                console.error(`   Safety checks that failed:`)
                for (const b of blocks) console.error(`   • ${b}`)
                exitCode = 2
            } else {
                if (blocks.length) {
                    console.warn(`\n⚠ --force overriding ${blocks.length} failed safety check(s):`)
                    for (const b of blocks) console.warn(`   • ${b}`)
                }
                // Back up the full documents first — this is the only copy.
                const stamp = new Date().toISOString().replace(/[:.]/g, "-")
                const backupPath = path.join(__dirname, "..", `deleted-by-sync-${stamp}.json`)
                const fullDocs = await Product.find({ id: { $in: confirmedGone.map((p) => p.id) } }).lean()
                fs.writeFileSync(backupPath, JSON.stringify(fullDocs, null, 2))
                console.log(`\nbacked up ${fullDocs.length} full documents to ${path.basename(backupPath)}`)

                const res = await Product.deleteMany({ id: { $in: confirmedGone.map((p) => p.id) } })
                console.log(`✅ deleted ${res.deletedCount} products the supplier no longer lists`)
                console.log(`   (no tombstones written — if the supplier restocks one, a later scrape may re-add it)`)
            }
        }
    }

    // ── Machine-readable report ──────────────────────────────────────────────
    const reportPath = path.join(__dirname, "..", "supplier-sync-report.json")
    fs.writeFileSync(
        reportPath,
        JSON.stringify(
            {
                ranAt: new Date().toISOString(),
                mode: apply ? "apply" : "dry-run",
                options: { withTitles, noDelete, force, limit: limit || null },
                catalogueSize,
                checked,
                stock: {
                    changed: stockChanges.length,
                    unchanged: unchangedStock,
                    backInStock: backInStock.length,
                    nowZero: nowStock0,
                    changes: stockChanges,
                },
                removed: {
                    // firstPassCandidates is the outage signal — keep it in the
                    // report even when pass 2 narrowed it to nothing.
                    firstPassCandidates: goneCandidates.length,
                    verifyCompleted,
                    confirmed: confirmedGone.map((p) => ({ id: p.id, name: p.name, url: p.url })),
                    reprieved,
                },
                unknown,
                pricesWritten: 0,
            },
            null,
            2
        )
    )
    console.log(`\nfull report: ${path.basename(reportPath)}`)
} catch (err) {
    console.error(`\n❌ sync failed: ${err.message}`)
    console.error(err.stack)
    exitCode = 1
} finally {
    try {
        await keeper.close()
    } catch {
        // non-fatal
    }
    await mongoose.disconnect()
    process.exit(exitCode)
}
