/**
 * Re-read specific categories from mobigo.ie without running a whole scrape —
 * run from terminal:
 *
 *   node utils/backfillCategoryPaths.js                       # every node, tags only
 *   node utils/backfillCategoryPaths.js mobile-cases-by-brand/apple
 *   node utils/backfillCategoryPaths.js --insert mobile-cases-by-brand/samsung
 *
 * Two jobs, one crawl:
 *
 *   default    records which products belong to each category and nothing else. No
 *              product is inserted, updated, deleted or re-priced. Cheap, safe, and
 *              idempotent — it exists because refreshing the category tree makes new
 *              nodes appear in the sidebar, but each one lists nothing until
 *              something has recorded what belongs in it.
 *
 *   --insert   also adds products the store doesn't have yet, the same way a full
 *              scrape would (unapproved, so they wait in the admin queue).
 *              This is what retries a category the scrape failed on — its
 *              scrape-report.json failedUrls — without re-crawling everything.
 *
 * Neither mode sends the new-product digest email, and neither re-scrapes product
 * descriptions: use --insert for coverage, then a full scrape when you want the
 * long descriptions and full-resolution image galleries filled in too.
 *
 * Reads the category tree straight from MongoDB, so run utils/refreshCategories.js
 * first if the supplier's menu has changed.
 */
import dotenv from "dotenv"
dotenv.config()

import mongoose from "mongoose"
import puppeteer from "puppeteer"
import { finalizeProduct, flattenCategoryTree, login, newPage, scrapeUrl } from "./srapper.js"
import { categoryTagFor } from "./categoryPath.js"
import { Category } from "../models/Category.js"
import { Product } from "../models/Product.js"
import { saveProductBatch } from "./scrapePersistence.js"

const CONCURRENCY = 5

await mongoose.connect(process.env.MONGO_URI)
console.log("MongoDB connected.")

const categories = await Category.find().sort({ order: 1, _id: 1 }).lean()
if (!categories.length) {
    console.error("❌ No categories in MongoDB — run `node utils/refreshCategories.js` first.")
    await mongoose.disconnect()
    process.exit(1)
}

// Every node of the tree, each with the slug path that addresses it. Deduplicated
// by URL, since the supplier cross-links the same node from several branches.
const args = process.argv.slice(2)
const insertNew = args.includes("--insert")
const onlyPath = (args.find((a) => !a.startsWith("--")) || "").replace(/^\/+|\/+$/g, "")
const nodes = []
const seenUrls = new Set()
for (const node of flattenCategoryTree(categories)) {
    if (!node.url || seenUrls.has(node.url)) continue
    const path = node.pathSlugs.join("/")
    if (onlyPath && path !== onlyPath && !path.startsWith(`${onlyPath}/`)) continue
    seenUrls.add(node.url)
    nodes.push(node)
}

if (!nodes.length) {
    console.error(`❌ No category nodes match "${onlyPath}".`)
    await mongoose.disconnect()
    process.exit(1)
}

const deepNodes = nodes.filter((n) => n.pathSlugs.length > 3).length
console.log(
    `${nodes.length} category nodes to read (${deepNodes} of them below level 3)${onlyPath ? ` — limited to ${onlyPath}` : ""}`
)

// A product is matched to what we already store by its product code first (that
// is what the scraper uses as the document id whenever the source provides one)
// and by its source URL otherwise.
const stored = await Product.find({}, { id: 1, productCode: 1, url: 1, name: 1 }).lean()
const byCode = new Map()
const byUrl = new Map()
for (const p of stored) {
    if (p.productCode) byCode.set(p.productCode, p)
    if (p.url) byUrl.set(p.url.split("?")[0], p)
}
console.log(insertNew ? "mode: --insert (records placements AND adds missing products)" : "mode: placements only (no product is added or changed)")
console.log(`${stored.length} products already stored\n`)

const resolve = (scraped) =>
    (scraped.productCode && byCode.get(scraped.productCode)) ||
    (scraped.url && byUrl.get(scraped.url.split("?")[0])) ||
    null

const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
})

let exitCode = 0
let done = 0
let merged = 0
let unmatched = 0
const failed = []
// The set of products that gained at least one placement, so the summary counts
// products rather than writes (each product sits in several nodes).
const touched = new Set()
// Products this run added (only with --insert), and any it could not add because
// the source gave no product code to key them by.
const inserted = new Set()
let skippedNoCode = 0

try {
    // Authenticate on the first tab before opening the rest: the session cookie is
    // shared across the whole browser context, so every later tab is already logged
    // in, and the login form is typed into a browser that has nothing else running.
    const first = await newPage(browser)
    await first.setViewport({ width: 1280, height: 900 })
    await login(first)

    const pages = [first]
    for (let i = 1; i < CONCURRENCY; i++) {
        const page = await newPage(browser)
        await page.setViewport({ width: 1280, height: 900 })
        pages.push(page)
    }

    let next = 0
    await Promise.all(
        pages.map(async (page) => {
            while (next < nodes.length) {
                const node = nodes[next++]
                const tag = categoryTagFor(node.pathSlugs)
                try {
                    const { products, expected } = await scrapeUrl(page, node.url, tag)
                    if (expected !== null && products.length < expected) {
                        console.warn(`  ⚠ ${node.label}: source reports ${expected}, crawl returned ${products.length}`)
                    }
                    const batch = []
                    for (const scraped of products) {
                        const existing = resolve(scraped)
                        if (!existing) {
                            unmatched++
                            // The source's own product code is the id the scraper uses,
                            // so inserting without one would have to invent an id that
                            // could collide with the crawler's own sequence. Every
                            // listing link carries a code, so this is a report-and-skip
                            // rather than a real limitation.
                            if (!insertNew) continue
                            if (!scraped.productCode || scraped.productCode.length <= 2) {
                                skippedNoCode++
                                continue
                            }
                            const id = scraped.productCode
                            batch.push({
                                product: finalizeProduct(scraped, id),
                                tag,
                                isFirstSeen: true,
                                sparse: !!scraped.sparse,
                            })
                            // Remembered so a product listed under several of the nodes
                            // in this run is inserted once and then merged, exactly as a
                            // full scrape would treat it.
                            byCode.set(id, { id, name: scraped.name })
                            if (scraped.url) byUrl.set(scraped.url.split("?")[0], { id, name: scraped.name })
                            inserted.add(id)
                            continue
                        }
                        // Same write path the scraper itself uses for a product it
                        // has seen before: merge this placement, touch nothing else.
                        batch.push({
                            product: { id: existing.id, name: existing.name },
                            tag,
                            tagOnly: true,
                        })
                        touched.add(existing.id)
                    }
                    if (batch.length) {
                        await saveProductBatch(batch)
                        merged += batch.length
                    }
                } catch (err) {
                    failed.push({ label: node.label, error: err.message })
                    console.warn(`  ✗ ${node.label}: ${err.message.slice(0, 90)}`)
                }
                done++
                if (done % 25 === 0 || done === nodes.length) {
                    console.log(`[backfill] ${done}/${nodes.length} nodes — ${merged} placements merged onto ${touched.size} products`)
                }
            }
        })
    )

    console.log(`\n✅ ${merged} placements merged onto ${touched.size} products across ${nodes.length} category nodes`)
    if (insertNew) {
        console.log(`   ${inserted.size} products added (unapproved — they wait in /admin/upcoming-products)`)
        if (skippedNoCode) console.log(`   ${skippedNoCode} listings had no product code and were skipped`)
        console.log(`   descriptions and full-resolution galleries are NOT fetched here — run a full scrape for those`)
    } else if (unmatched) {
        console.log(`   ${unmatched} listed products aren't in our store yet — re-run with --insert to add them.`)
    }
    if (failed.length) {
        console.warn(`   ${failed.length} nodes could not be read:`)
        for (const f of failed.slice(0, 20)) console.warn(`     - ${f.label}: ${f.error.slice(0, 80)}`)
    }
} catch (err) {
    console.error("\n❌ Backfill failed:", err.message)
    exitCode = 1
} finally {
    try {
        await browser.close()
    } catch {
        // teardown failure must never mask the work already committed above
    }
    await mongoose.disconnect()
    process.exit(exitCode)
}
