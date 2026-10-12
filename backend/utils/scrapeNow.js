/**
 * Standalone scraper — run directly from a terminal:
 *
 *   node utils/scrapeNow.js
 *
 * Crawls the supplier and saves categories, banners and products straight to
 * MongoDB, awaiting the whole run (so there is no HTTP timeout to work around,
 * unlike GET /api/scrape-save which answers 202 and finishes in the background).
 *
 * ─── This used to be a catalogue-destroying command ─────────────────────────────
 *
 * It previously ran the crawl, then did:
 *
 *     await Category.deleteMany()
 *     await Product.deleteMany()      // every product, gone
 *     await Banner.deleteMany()
 *     await Product.insertMany(products)   // reinserted at the SUPPLIER's price
 *
 * The store's prices are a retail markup built by hand over ~7000 products, and
 * the supplier's own figure is a fraction of it (EUR 8.45 against EUR 20 on live
 * spot checks). So the obvious command for "re-run the scraper" silently replaced
 * every hand-set price with wholesale, dropped every admin approval, and reset the
 * categoryTags that the deep category pages depend on. It also threw away products
 * the crawl happened to miss, which — with the crawl having quietly stopped at 480
 * of 826 category nodes — was most of the catalogue.
 *
 * It now takes exactly the same incremental path the server's own scrape uses
 * (see runScrapeAndSave in controllers/productController.js): nothing is wiped,
 * products already stored keep their price, approval and everything else, and
 * only genuinely new products are inserted — at the supplier's price, for the
 * admin to mark up afterwards.
 *
 * ─── Change tracking (what this run actually watches) ───────────────────────────
 *
 * Every product the crawl sees has its own detail page read, INCLUDING products
 * already in the collection, and three fields are kept in step with the supplier:
 *
 *   availability (stock)  — the reason this runs on a schedule. The category
 *                           listings carry no stock figure at all any more, so the
 *                           detail page is the only source, and nothing used to
 *                           refresh it for products already stored: 4836 of 7108
 *                           were carrying a wrong figure, 659 of them reading
 *                           out-of-stock while the supplier held real quantities.
 *   title                 — a renamed product is renamed here too.
 *   description           — same.
 *
 * Everything that changed is printed at the end and written to
 * supplier-changes.json. A product whose page has gone has its stock zeroed so it
 * cannot be ordered, but is NOT deleted — deletion needs the extra verification in
 * utils/syncSupplier.js.
 *
 * PRICE IS NEVER READ OR WRITTEN for a product already in the store. Set
 * refreshExisting:false to go back to filling in new products only.
 */
import dotenv from "dotenv"
dotenv.config()

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import mongoose from "mongoose"
import scrapeAll, { normalizeProductUrl } from "./srapper.js"
import { Product } from "../models/Product.js"
import { DeletedProduct } from "../models/DeletedProduct.js"
import {
    saveCategories,
    saveBanners,
    saveProductBatch,
    updateProductImages,
    updateProductMeta,
    markProductUnavailable,
    reconcileCatalogue,
} from "./scrapePersistence.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

if (!process.env.MOBIGO_EMAIL || !process.env.MOBIGO_PASSWORD) {
    console.error("❌ MOBIGO_EMAIL and MOBIGO_PASSWORD must be set in .env")
    process.exit(1)
}

console.log("Connecting to MongoDB…")
await mongoose.connect(process.env.MONGO_URI)
console.log(`MongoDB connected: ${mongoose.connection.host}\n`)

let exitCode = 0
try {
    const before = await Product.countDocuments()

    // Incremental mode. Everything already stored is left exactly as it is —
    // this set is what tells the crawler to re-tag rather than re-write.
    const stored = await Product.find({}, { id: 1, url: 1 }).lean()
    const existingIds = new Set(stored.map((p) => p.id))
    // And the duplicate guard: a product is recognised by its URL even if this
    // release would derive a different id for it than the run that stored it.
    const existingByUrl = new Map()
    for (const p of stored) {
        const key = normalizeProductUrl(p.url)
        if (key && !existingByUrl.has(key)) existingByUrl.set(key, p.id)
    }

    // Admin-deleted products are seeded into the same skip-set, which is what
    // makes those deletions permanent against any future crawl.
    const tombstoned = await DeletedProduct.find({}, { id: 1 }).lean()
    for (const t of tombstoned) existingIds.add(t.id)

    console.log(`${before} products already stored (kept as-is, prices untouched)`)
    if (tombstoned.length) console.log(`${tombstoned.length} admin-deleted products will stay deleted`)
    console.log("")

    let added = 0
    const { categories, products, banners, crawl, supplierChanges } = await scrapeAll({
        existingByUrl,
        existingIds,
        onNavigationReady: async (cats) => {
            await saveCategories(cats)
            console.log(`saved ${cats.length} categories`)
        },
        onBannersReady: async (banns) => {
            await saveBanners(banns)
        },
        onProductBatch: async (batch) => {
            const saved = (await saveProductBatch(batch)) ?? []
            added += saved.length
        },
        onImagesReady: updateProductImages,
        // Change tracking. Every product the crawl sees has its detail page read,
        // and these two hooks write the only things the supplier is allowed to
        // change on a product we already store — availability, title, description.
        // Neither can reach price.
        onProductMeta: updateProductMeta,
        onProductGone: markProductUnavailable,
    })

    // Category membership + delisted products, from this run's own sightings.
    // Only acts on a complete crawl — see reconcileCatalogue.
    const recon = await reconcileCatalogue({ products, crawl })

    const after = await Product.countDocuments()
    console.log(`\n──────── DONE ────────`)
    console.log(`categories          : ${categories.length}`)
    console.log(`banners             : ${banners.length}`)
    console.log(`products seen       : ${products.length}`)
    console.log(`products in store   : ${before} -> ${after}  (+${after - before})`)
    console.log(`new products added  : ${added}`)
    console.log(`prices changed      : 0  (existing prices are never written)`)
    console.log(`nodes visited       : ${crawl.nodesVisited}/${crawl.totalNodes}`)

    // ── What the supplier changed since the last run ─────────────────────────
    const chg = supplierChanges ?? []
    const stockMoves = chg.filter((c) => c.stock)
    const backInStock = stockMoves.filter((c) => !c.stock.from && c.stock.to > 0)
    const outOfStock = stockMoves.filter((c) => c.stock.to === 0 && c.stock.from > 0)
    const removed = chg.filter((c) => c.reason === "removed at supplier")
    const retitled = chg.filter((c) => c.name)
    const redescribed = chg.filter((c) => c.description)

    console.log(`\n──────── SUPPLIER CHANGES ────────`)
    console.log(`products changed    : ${chg.length}`)
    console.log(`  availability      : ${stockMoves.length}`)
    console.log(`    ↳ back IN stock : ${backInStock.length}`)
    console.log(`    ↳ now OUT       : ${outOfStock.length}`)
    console.log(`  title changed     : ${retitled.length}`)
    console.log(`  description change: ${redescribed.length}`)
    console.log(`  removed at source : ${removed.length}  (stock zeroed, product kept)`)

    if (retitled.length) {
        console.log(`\ntitle changes:`)
        for (const c of retitled.slice(0, 15)) {
            console.log(`   ${c.id}`)
            console.log(`     was: ${String(c.name.from).slice(0, 70)}`)
            console.log(`     now: ${String(c.name.to).slice(0, 70)}`)
        }
        if (retitled.length > 15) console.log(`   … and ${retitled.length - 15} more`)
    }
    if (backInStock.length) {
        console.log(`\nback in stock (biggest first):`)
        for (const c of [...backInStock].sort((a, b) => b.stock.to - a.stock.to).slice(0, 12)) {
            console.log(`   ${String(c.stock.to).padStart(6)} units   ${c.id}`)
        }
    }
    console.log(`\n──────── CATEGORY RECONCILE ────────`)
    if (recon.skipped) {
        console.log(`skipped             : ${recon.skipped}`)
    } else {
        console.log(`products re-tagged  : ${recon.retagged}`)
        console.log(`  ↳ dropped from a category the supplier removed them from: ${recon.removedFromCategories.length}`)
        console.log(`hidden (delisted)   : ${recon.unlisted.length}  (page still up at supplier, listed in no category)`)
        console.log(`un-hidden (relisted): ${recon.relisted.length}`)
        if (recon.unlistAborted) console.warn(`⚠ hide step aborted: ${recon.unlistAborted}`)
        for (const u of recon.unlisted.slice(0, 15)) console.log(`   hidden  ${u.id}  ${String(u.name).slice(0, 70)}`)
        if (recon.unlisted.length > 15) console.log(`   … and ${recon.unlisted.length - 15} more`)
    }

    if (removed.length) {
        console.log(`\nremoved at the supplier — stock set to 0 so they cannot be ordered.`)
        console.log(`To delete them properly (with backup + double verification):`)
        console.log(`   node utils/syncSupplier.js            # dry run`)
        console.log(`   node utils/syncSupplier.js --apply`)
    }

    // A machine-readable copy, so a change can be looked up after the fact.
    try {
        const changeReportPath = path.join(__dirname, "..", "supplier-changes.json")
        fs.writeFileSync(
            changeReportPath,
            JSON.stringify(
                {
                    ranAt: new Date().toISOString(),
                    productsSeen: products.length,
                    crawlComplete: crawl.complete,
                    nodesVisited: crawl.nodesVisited,
                    totalNodes: crawl.totalNodes,
                    newProductsAdded: added,
                    pricesChanged: 0,
                    summary: {
                        changed: chg.length,
                        availability: stockMoves.length,
                        backInStock: backInStock.length,
                        outOfStock: outOfStock.length,
                        retitled: retitled.length,
                        redescribed: redescribed.length,
                        removedAtSource: removed.length,
                    },
                    changes: chg,
                    reconcile: recon,
                },
                null,
                2
            )
        )
        console.log(`\nchange report: supplier-changes.json`)
    } catch (err) {
        console.warn(`could not write supplier-changes.json: ${err.message}`)
    }

    if (!crawl.complete) {
        console.warn(`\n⚠ The crawl did NOT cover the whole category tree:`)
        if (crawl.notVisited.length) console.warn(`   ${crawl.notVisited.length} nodes were never visited`)
        if (crawl.failedUrls.length) console.warn(`   ${crawl.failedUrls.length} nodes failed after retries`)
        console.warn(`   Products under those nodes are missing from this run — see scrape-report.json.`)
        console.warn(`   Re-run to pick them up; do NOT treat this run as proof a product is gone.`)
    }

    if (added > 0) {
        console.log(`\nNOTE: the ${added} new products are stored UNAPPROVED and are not visible on the`)
        console.log(`      storefront yet (GET /api/products serves approved products only). Publish them`)
        console.log(`      from /admin/upcoming-products, or in bulk with:`)
        console.log(`        node utils/approveProducts.js            # dry run first`)
        console.log(`        node utils/approveProducts.js --apply`)
    }
} catch (err) {
    console.error("\n❌ Scrape failed:", err.message)
    console.error(err.stack)
    exitCode = 1
} finally {
    await mongoose.disconnect()
    process.exit(exitCode)
}
