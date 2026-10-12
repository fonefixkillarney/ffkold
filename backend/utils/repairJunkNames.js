/**
 * Put back the real name of every product whose name is a block-page title.
 *
 *   node utils/repairJunkNames.js                      # DRY RUN — counts only
 *   node utils/repairJunkNames.js --apply              # re-read each page, write names
 *   node utils/repairJunkNames.js --apply --from=a.json,b.json
 *                                                      # names from JSON backups first
 *   --concurrency=N   tabs for the live re-read (default 3 — gentle on purpose)
 *   --no-live         backups only, no browser
 *
 * ─── What happened ──────────────────────────────────────────────────────────────
 *
 * On 2026-10-01 the storefront showed 4698 of 7081 products titled "Just a
 * moment...". That is Cloudflare's anti-bot interstitial: the detail-page pass
 * (8 tabs, ~7000 pages) started getting challenged, and readProductPage took
 * document.title as the product's name, so updateProductMeta saved it. Fixed at
 * the source (readProductPage now returns `blocked` and no name for such a page;
 * updateProductMeta refuses a junk title). This script repairs the damage and
 * installs a validator on the products collection so the same write is rejected
 * by MongoDB itself — that protects the catalogue even from a deployed backend
 * still running the old code.
 *
 * Only `name` is written, and only where the stored name is still junk, so a
 * product that a concurrent scrape already fixed is never touched.
 */
import dotenv from "dotenv"
dotenv.config()

import fs from "fs"
import mongoose from "mongoose"
import { Product } from "../models/Product.js"
import { JUNK_TITLE_RE, isJunkTitle } from "./blocklist.js"
import { createBrowserKeeper, isLoggedOutUrl, login, readProductPage } from "./srapper.js"

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const live = !args.includes("--no-live")
const concurrency = Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 3)
const fromFiles = (args.find((a) => a.startsWith("--from="))?.slice("--from=".length) ?? "").split(",").filter(Boolean)
const BACKOFF_MS = 20000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await mongoose.connect(process.env.MONGO_URI)
console.log(`MongoDB connected: ${mongoose.connection.host}  (${apply ? "APPLY" : "DRY RUN"})`)

// ── 1. Database-level guard ───────────────────────────────────────────────────
// "moderate": documents that are already junk can still be updated (that is how
// they get repaired); a valid document can never be changed INTO a junk name.
if (apply) {
    await mongoose.connection.db.command({
        collMod: "products",
        validator: { name: { $not: { $regex: JUNK_TITLE_RE.source, $options: "i" } } },
        validationLevel: "moderate",
        validationAction: "error",
    })
    console.log("validator on products.name: installed")
}

const junkFilter = { name: { $regex: JUNK_TITLE_RE.source, $options: "i" } }
const writeName = async (id, name) => {
    if (!apply) return true
    const res = await Product.updateOne({ id, ...junkFilter }, { $set: { name } })
    return res.modifiedCount > 0
}

let todo = await Product.find(junkFilter, { id: 1, url: 1 }).lean()
console.log(`${todo.length} product(s) carry a block-page title`)

// ── 2. Names from local backups (instant) ─────────────────────────────────────
// Any object in the file with a string `id` and a usable `name` (or a
// {from, to} change record) is a candidate.
if (fromFiles.length && todo.length) {
    const known = new Map()
    const walk = (v) => {
        if (Array.isArray(v)) return v.forEach(walk)
        if (!v || typeof v !== "object") return
        if (typeof v.id === "string") {
            const n = v.name
            const pick = typeof n === "string" ? n : [n?.to, n?.from].find((s) => typeof s === "string" && !isJunkTitle(s))
            if (pick?.trim() && !isJunkTitle(pick)) known.set(v.id, pick.trim())
        }
        Object.values(v).forEach(walk)
    }
    for (const f of fromFiles) {
        try {
            walk(JSON.parse(fs.readFileSync(f, "utf8")))
        } catch (err) {
            console.warn(`skipping ${f}: ${err.message}`)
        }
    }
    let restored = 0
    for (const p of todo) if (known.has(p.id) && (await writeName(p.id, known.get(p.id)))) restored++
    console.log(`backups: ${known.size} names known, ${restored} product(s) ${apply ? "restored" : "restorable"}`)
    if (apply) todo = await Product.find(junkFilter, { id: 1, url: 1 }).lean()
}

// ── 3. Live re-read of each remaining product's page ──────────────────────────
if (live && todo.length && apply) {
    const queue = todo.filter((p) => p.url)
    console.log(`re-reading ${queue.length} product page(s) with ${concurrency} tab(s)…`)
    const keeper = createBrowserKeeper({ maxRelaunches: 8 })
    await keeper.ensure()
    let idx = 0
    let fixed = 0
    let blocked = 0
    let failed = 0
    let done = 0

    async function worker() {
        let page = await keeper.page()
        while (idx < queue.length) {
            const p = queue[idx++]
            let ok = false
            for (let attempt = 0; attempt < 4 && !ok; attempt++) {
                try {
                    await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: 30000 })
                    if (isLoggedOutUrl(page.url())) {
                        await login(page)
                        continue
                    }
                    const info = await readProductPage(page)
                    if (info.gone) break // supplier 404 — no real title exists to restore
                    if (info.blocked) {
                        blocked++
                        await sleep(BACKOFF_MS * (attempt + 1))
                        continue
                    }
                    if (info.name && (await writeName(p.id, info.name))) fixed++
                    ok = true
                } catch {
                    await page.close().catch(() => {})
                    page = await keeper.page()
                }
            }
            if (!ok) failed++
            if (++done % 100 === 0 || done === queue.length) {
                console.log(`  ${done}/${queue.length}  fixed ${fixed}, blocked hits ${blocked}, unresolved ${failed}`)
            }
        }
        await page.close().catch(() => {})
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
    await keeper.close()
}

const left = await Product.countDocuments(junkFilter)
console.log(`\n${left} product(s) still carry a block-page title${left && apply ? " — re-run to retry them" : ""}`)
await mongoose.disconnect()
process.exit(0)
