/**
 * Double-check our categories against mobigo.ie, node by node — run from terminal:
 *
 *   node utils/auditCategoryProducts.js                 # representative sample
 *   node utils/auditCategoryProducts.js --all           # every node (slow)
 *   node utils/auditCategoryProducts.js mobile-cases-by-brand/apple/iphone-11-series
 *   node utils/auditCategoryProducts.js --all --json=audit.json
 *
 * For each category node it crawls the supplier's own listing and compares it with
 * the products our store files under that exact node, reporting three numbers:
 *
 *   MISSING  the supplier lists it, we don't have it at all
 *   UNTAGGED we have the product, but not filed under this category
 *   EXTRA    we file it under this category, the supplier doesn't list it there
 *
 * All three should be zero. MISSING means the crawl or the ingest skipped products;
 * UNTAGGED means the product exists but its placement was never recorded; EXTRA
 * means we are showing something in the wrong place. Products the admin has
 * not approved yet are counted separately — they are in the store but deliberately
 * invisible on the storefront, which is not a fault.
 */
import dotenv from "dotenv"
dotenv.config()

import mongoose from "mongoose"
import fs from "fs"
import puppeteer from "puppeteer"
import { flattenCategoryTree, login, newPage, scrapeUrl } from "./srapper.js"
import { categoryTagFor } from "./categoryPath.js"
import { Category } from "../models/Category.js"
import { Product } from "../models/Product.js"

const args = process.argv.slice(2)
const wantAll = args.includes("--all")
const jsonArg = args.find((a) => a.startsWith("--json="))
const explicitPaths = args.filter((a) => !a.startsWith("--"))
const CONCURRENCY = 4
// With no path and no --all, take a spread across every depth rather than the first
// N nodes, so one run says something about the whole tree.
const SAMPLE_PER_DEPTH = 8

await mongoose.connect(process.env.MONGO_URI)
const cats = await Category.find().sort({ order: 1, _id: 1 }).lean()
if (!cats.length) {
    console.error("❌ No categories in MongoDB — run `node utils/refreshCategories.js` first.")
    await mongoose.disconnect()
    process.exit(1)
}

const allNodes = flattenCategoryTree(cats).filter((n) => n.url)
let nodes
if (explicitPaths.length) {
    const wanted = new Set(explicitPaths.map((p) => p.replace(/^\/+|\/+$/g, "")))
    nodes = allNodes.filter((n) => wanted.has(n.pathSlugs.join("/")))
} else if (wantAll) {
    nodes = allNodes
} else {
    nodes = []
    for (let d = 1; d <= 8; d++) {
        nodes.push(...allNodes.filter((n) => n.pathSlugs.length === d).slice(0, SAMPLE_PER_DEPTH))
    }
}
if (!nodes.length) {
    console.error("❌ No matching category nodes.")
    await mongoose.disconnect()
    process.exit(1)
}
console.log(`auditing ${nodes.length} of ${allNodes.length} category nodes\n`)

// Our whole catalogue keyed the two ways a listing can be matched to it: the
// supplier's product code (which the scraper uses as the document id when it has
// one) and the product page URL.
const stored = await Product.find({}, { id: 1, productCode: 1, url: 1, approved: 1, categoryTags: 1 }).lean()
const byCode = new Map()
const byUrl = new Map()
for (const p of stored) {
    if (p.productCode) byCode.set(p.productCode, p)
    if (p.url) byUrl.set(p.url.split("?")[0], p)
}
const taggedAt = (path) =>
    new Set(stored.filter((p) => (p.categoryTags || []).some((t) => t.path === path)).map((p) => p.id))

const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
})

const results = []
let exitCode = 0
try {
    const first = await newPage(browser)
    await first.setViewport({ width: 1280, height: 900 })
    await login(first)
    const pages = [first]
    for (let i = 1; i < CONCURRENCY; i++) {
        const p = await newPage(browser)
        await p.setViewport({ width: 1280, height: 900 })
        pages.push(p)
    }

    let next = 0
    let done = 0
    await Promise.all(
        pages.map(async (page) => {
            while (next < nodes.length) {
                const node = nodes[next++]
                const path = node.pathSlugs.join("/")
                const tag = categoryTagFor(node.pathSlugs)
                try {
                    const { products: listed, expected } = await scrapeUrl(page, node.url, tag)
                    const ours = taggedAt(path)

                    const missing = []
                    const untagged = []
                    let unapproved = 0
                    const seenIds = new Set()
                    for (const item of listed) {
                        const hit =
                            (item.productCode && byCode.get(item.productCode)) ||
                            (item.url && byUrl.get(item.url.split("?")[0])) ||
                            null
                        if (!hit) {
                            missing.push(item.name)
                            continue
                        }
                        seenIds.add(hit.id)
                        if (!ours.has(hit.id)) untagged.push(item.name)
                        else if (!hit.approved) unapproved++
                    }
                    // Filed here by us but absent from the supplier's own listing.
                    const extra = [...ours].filter((id) => !seenIds.has(id))

                    results.push({
                        path,
                        label: node.label,
                        supplierReports: expected,
                        supplierListed: listed.length,
                        weFileHere: ours.size,
                        missing: missing.length,
                        untagged: untagged.length,
                        extra: extra.length,
                        unapproved,
                        missingSample: missing.slice(0, 5),
                        untaggedSample: untagged.slice(0, 5),
                        extraSample: extra.slice(0, 5),
                    })
                } catch (err) {
                    results.push({ path, label: node.label, error: err.message.slice(0, 120) })
                }
                done++
                if (done % 10 === 0 || done === nodes.length) console.log(`[audit] ${done}/${nodes.length}`)
            }
        })
    )

    const clean = results.filter((r) => !r.error && !r.missing && !r.untagged && !r.extra)
    const problems = results.filter((r) => r.error || r.missing || r.untagged || r.extra)
    problems.sort((a, b) => (b.missing + b.untagged + b.extra || 0) - (a.missing + a.untagged + a.extra || 0))

    console.log(`\n${"=".repeat(78)}`)
    console.log(`clean nodes:    ${clean.length}/${results.length}`)
    console.log(`nodes with a discrepancy: ${problems.length}`)
    const sum = (k) => results.reduce((n, r) => n + (r[k] || 0), 0)
    console.log(`\ntotals across audited nodes:`)
    console.log(`  supplier lists      ${sum("supplierListed")}`)
    console.log(`  we file here        ${sum("weFileHere")}`)
    console.log(`  MISSING  (not in our store at all)   ${sum("missing")}`)
    console.log(`  UNTAGGED (in store, not filed here)  ${sum("untagged")}`)
    console.log(`  EXTRA    (filed here, not listed)    ${sum("extra")}`)
    console.log(`  in store but awaiting approval       ${sum("unapproved")}`)

    if (problems.length) {
        console.log(`\nworst offenders:`)
        for (const r of problems.slice(0, 20)) {
            if (r.error) {
                console.log(`  ERROR ${r.path}: ${r.error}`)
                continue
            }
            console.log(
                `  ${r.path}\n      supplier=${r.supplierListed} ours=${r.weFileHere} missing=${r.missing} untagged=${r.untagged} extra=${r.extra}`
            )
            if (r.missingSample.length) console.log(`      missing e.g.: ${r.missingSample.slice(0, 2).join(" | ")}`)
            if (r.extraSample.length) console.log(`      extra e.g.:   ${r.extraSample.slice(0, 2).join(" | ")}`)
        }
    }

    if (jsonArg) {
        const out = jsonArg.slice("--json=".length)
        fs.writeFileSync(out, JSON.stringify({ auditedAt: new Date().toISOString(), results }, null, 2))
        console.log(`\nfull results written to ${out}`)
    }
} catch (err) {
    console.error("\n❌ audit failed:", err.message)
    exitCode = 1
} finally {
    try {
        await browser.close()
    } catch {
        // teardown failure must not mask the audit output above
    }
    await mongoose.disconnect()
    process.exit(exitCode)
}
