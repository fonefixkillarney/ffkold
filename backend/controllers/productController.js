import scrapeAll, { normalizeProductUrl } from "../utils/srapper.js"
import { Product } from "../models/Product.js"
import { Category } from "../models/Category.js"
import { Banner } from "../models/Banner.js"
import { DeletedProduct } from "../models/DeletedProduct.js"
import {
    saveCategories,
    saveBanners,
    saveProductBatch,
    updateProductImages,
    updateProductMeta,
    markProductUnavailable,
    reconcileCatalogue,
} from "../utils/scrapePersistence.js"
import { isBlockedCategoryName, isBlockedBanner, isBlockedProduct, stripBlockedTags, displayCategoryName, pruneBlockedCategoryNodes } from "../utils/blocklist.js"
import { slimCategoryTags } from "../utils/categoryPath.js"
import { sendNewProductsEmail } from "../utils/mailer.js"

// Scraping state — in-memory, survives for the lifetime of the process
let scrapeStatus = { running: false, done: false, message: "idle", error: null, startedAt: null, completedAt: null, productsSaved: 0 }
// The one pending automatic re-scrape, if any — see scheduleNextScrape().
let nextScrapeTimer = null
let nextScrapeAt = null

// Counts only. The raw change rows can run to thousands of entries (4836 stock
// corrections on the first full pass), and this object is polled.
function summariseChanges(changes) {
    const list = changes ?? []
    const stockMoves = list.filter((c) => c.stock)
    return {
        changed: list.length,
        availability: stockMoves.length,
        backInStock: stockMoves.filter((c) => !c.stock.from && c.stock.to > 0).length,
        outOfStock: stockMoves.filter((c) => c.stock.to === 0 && c.stock.from > 0).length,
        retitled: list.filter((c) => c.name).length,
        redescribed: list.filter((c) => c.description).length,
        removedAtSource: list.filter((c) => c.reason === "removed at supplier").length,
        pricesChanged: 0,
    }
}

// GET /api/scrape — scrape and return without saving (for quick test/preview)
export const getProducts = async (req, res) => {
    try {
        const { categories, products, banners } = await scrapeAll()
        res.status(200).json({
            success: true,
            count: products.length,
            data: products.slice(0, 50), // limit preview
            categories,
            banners,
        })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// Kicks off a scrape that saves categories/banners/products to MongoDB as soon as
// each is scraped, instead of waiting for the entire run to finish. Shared by the
// manual /api/scrape-save route and the automatic run at server startup — guarded
// by scrapeStatus.running so only one scrape is ever in flight at a time.
export function runScrapeAndSave() {
    if (scrapeStatus.running) return scrapeStatus

    // Whatever started this run, the pending automatic one is now redundant —
    // this run books the next one itself when it finishes.
    clearTimeout(nextScrapeTimer)
    nextScrapeTimer = null
    nextScrapeAt = null

    scrapeStatus = {
        running: true,
        done: false,
        message: "Starting scrape…",
        error: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
        productsSaved: 0,
    }

    ;(async () => {
        try {
            // DB-first: whatever is already saved keeps being served instantly by
            // /api/products while this runs. The scrape itself goes incremental —
            // a product already in MongoDB is never re-saved or re-enriched, it
            // only has this run's category placements merged into its tags.
            scrapeStatus.message = "Loading existing products from DB…"
            const stored = await Product.find({}, { id: 1, url: 1 }).lean()
            const existingIds = new Set(stored.map((p) => p.id))
            // Duplicate guard. A product is recognised by its URL, not only by the
            // id this release happens to derive for it: the collection's ids came
            // from three different derivations over time, and a product whose id
            // derivation drifted was being inserted a SECOND time — at the
            // supplier's wholesale price, right next to the admin's marked-up copy.
            // That had already produced 74 duplicate documents, some of the same
            // product on sale at €15, €10 and €5 at once.
            const existingByUrl = new Map()
            for (const p of stored) {
                const key = normalizeProductUrl(p.url)
                if (key && !existingByUrl.has(key)) existingByUrl.set(key, p.id)
            }

            // Products the admin deleted are seeded into the same skip-set,
            // which is what makes the deletion permanent: the crawler treats them
            // as "already handled" and never re-inserts them on any future run.
            const tombstoned = await DeletedProduct.find({}, { id: 1 }).lean()
            for (const t of tombstoned) existingIds.add(t.id)
            if (tombstoned.length) console.log(`[scrape] ${tombstoned.length} deleted products will stay deleted`)

            // saveProductBatch returns only the products it actually ADDED — a
            // product already in the DB reaches it too now (so this run's category
            // placements, including the deep levels 4-6, get merged onto it) but is
            // deliberately left out of what comes back. Deduped by id, these become
            // the one digest email the admin gets when the run finishes.
            const newProductsById = new Map()

            scrapeStatus.message = `Logging in and scraping… (${existingIds.size} products already in DB will be kept as-is)`
            const { categories, products, banners, crawl, supplierChanges } = await scrapeAll({
                existingByUrl,
                existingIds,
                onNavigationReady: async (cats) => {
                    await saveCategories(cats)
                    scrapeStatus.message = `Saved ${cats.length} categories — scraping products…`
                },
                onBannersReady: async (banns) => {
                    await saveBanners(banns)
                },
                onProductBatch: async (batch) => {
                    // Only what was actually written — saveProductBatch drops
                    // blocklisted products, which must not land in the digest email.
                    const saved = (await saveProductBatch(batch)) ?? []
                    for (const { product } of saved) {
                        if (product?.id && !newProductsById.has(product.id)) {
                            newProductsById.set(product.id, {
                                id: product.id,
                                name: product.name,
                                url: product.url,
                                image: product.images?.[0] || "",
                                price: product.price,
                            })
                        }
                    }
                    scrapeStatus.productsSaved += saved.length
                    scrapeStatus.message = `Scraping products… ${scrapeStatus.productsSaved} new products added so far`
                },
                onImagesReady: updateProductImages,
                // Change tracking: every product the crawl sees has its detail page
                // read, including ones already stored, and these hooks write the
                // only fields the supplier may change — availability, title,
                // description. Neither can reach price.
                onProductMeta: updateProductMeta,
                onProductGone: markProductUnavailable,
                // This makes the run re-read every product rather than only new
                // ones, which is what keeps availability true. It is also the
                // expensive part: one page load per product, ~7100 of them, while
                // this server is serving traffic. Set SCRAPE_REFRESH_EXISTING=false
                // to fall back to new-products-only on this path — utils/scrapeNow.js
                // can then do the full pass from a terminal instead.
                refreshExisting: process.env.SCRAPE_REFRESH_EXISTING !== "false",
            })

            // Drop placements the supplier removed and hide products it lists
            // nowhere any more. A no-op on an incomplete crawl.
            let reconcile = null
            try {
                reconcile = await reconcileCatalogue({ products, crawl })
            } catch (err) {
                console.warn(`[scrape] category reconcile failed (non-fatal): ${err.message}`)
            }

            // New-product notification: one digest email to the admin, each entry
            // linking to the product on our store (to edit) + its original source.
            const newProducts = [...newProductsById.values()]
            if (newProducts.length) {
                try {
                    await sendNewProductsEmail(newProducts)
                } catch (err) {
                    console.warn(`[scrape] new-product email failed (non-fatal): ${err.message}`)
                }
            }

            // A truncated crawl must not report success. The run that stopped at
            // 480 of 826 nodes ended with this exact message saying "Scrape
            // complete", which is why nobody knew ~300 category nodes had never
            // been opened. `crawl.complete` is the only in-band signal for that,
            // so it is surfaced both in the message and as structured fields on
            // the status the admin polls.
            const incomplete = crawl && !crawl.complete
            scrapeStatus = {
                running: false,
                done: true,
                message: incomplete
                    ? `Scrape INCOMPLETE: ${products.length} products across ${categories.length} categories, ` +
                      `${banners.length} banners — only ${crawl.nodesVisited}/${crawl.totalNodes} category nodes covered ` +
                      `(${crawl.notVisited.length} never visited, ${crawl.failedUrls.length} failed). Re-run to pick up the rest.`
                    : `Scrape complete: ${products.length} products across ${categories.length} categories, ${banners.length} banners`,
                error: null,
                startedAt: scrapeStatus.startedAt,
                completedAt: new Date().toISOString(),
                productsSaved: scrapeStatus.productsSaved,
                crawl: crawl
                    ? {
                          complete: crawl.complete,
                          nodesVisited: crawl.nodesVisited,
                          totalNodes: crawl.totalNodes,
                          notVisited: crawl.notVisited.length,
                          failedUrls: crawl.failedUrls.length,
                      }
                    : null,
                // What the supplier changed on products already in the store. The
                // counts, not the rows: this object is polled by the admin panel.
                supplierChanges: summariseChanges(supplierChanges),
                reconcile: reconcile?.skipped
                    ? { skipped: reconcile.skipped }
                    : reconcile
                      ? {
                            retagged: reconcile.retagged,
                            removedFromCategories: reconcile.removedFromCategories.length,
                            unlisted: reconcile.unlisted.length,
                            relisted: reconcile.relisted.length,
                            unlistAborted: reconcile.unlistAborted,
                        }
                      : null,
            }
            console.log(incomplete ? "[scrape] ⚠" : "[scrape] ✅", scrapeStatus.message)
        } catch (err) {
            scrapeStatus = {
                running: false,
                done: false,
                message: "Scrape failed",
                error: err.message,
                startedAt: scrapeStatus.startedAt,
                completedAt: new Date().toISOString(),
                productsSaved: scrapeStatus.productsSaved,
            }
            console.error("[scrape] ❌", err.message)
        } finally {
            // Failed or incomplete runs re-book too — a crash is exactly when
            // the next pass matters most.
            scheduleNextScrape()
        }
    })()

    return scrapeStatus
}

// Automatic re-scrape. Supplier stock moves all day, so every run — the first
// one after boot, a manual one, a failed one — books the next for this long
// after it ENDS. Measured from the end, not the start: a full crawl re-reads
// ~7100 detail pages and has taken far longer than two hours on this machine
// (~12h on 2026-09-24 at reduced concurrency), so a start-to-start clock would
// keep firing into a run that is still going.
// SCRAPE_INTERVAL_HOURS in .env retunes it; 0 turns it off.

// Read on every call, not at module load: ESM evaluates this file before
// server.js's dotenv.config() line runs, so a top-level read would never see .env.
function scrapeIntervalMs() {
    const raw = process.env.SCRAPE_INTERVAL_HOURS
    const hours = raw === undefined || raw === "" ? 2 : Number(raw)
    return Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1000 : 0
}

export function scheduleNextScrape() {
    const intervalMs = scrapeIntervalMs()
    if (!intervalMs) return

    clearTimeout(nextScrapeTimer)
    nextScrapeAt = new Date(Date.now() + intervalMs).toISOString()
    nextScrapeTimer = setTimeout(() => {
        nextScrapeTimer = null
        nextScrapeAt = null
        console.log("[scrape] ⏰ automatic re-scrape starting")
        runScrapeAndSave()
    }, intervalMs)
    console.log(`[scrape] next automatic scrape at ${nextScrapeAt}`)
}

// GET /api/scrape-save — kick off background scrape, respond immediately with 202
export const scrapeAndSaveProducts = async (req, res) => {
    const wasAlreadyRunning = scrapeStatus.running
    const status = runScrapeAndSave()
    res.status(202).json({
        success: true,
        message: wasAlreadyRunning ? "Scrape already running" : "Scrape started in background. Poll GET /api/scrape-status for progress.",
        status,
    })
}

// GET /api/scrape-status — check if scrape is running / done
export const getScrapeStatus = (req, res) => {
    res.json({ success: true, status: { ...scrapeStatus, nextRunAt: nextScrapeAt } })
}

// Guards the auto-scrape below so it fires at most once per process — reset
// naturally on every restart (nodemon or otherwise), matching the previous
// "rescrape on every boot" behavior, just deferred past the first read. The
// repeats after that come from scheduleNextScrape(), not from here.
let autoScrapeTriggered = false

// Fields the storefront's grids/cards never read, left out of the catalogue
// response. longDescription alone was 1.8MB of a 7.6MB payload that every visitor
// waited on before a single product could render; the product page fetches it
// per-product from /api/products/:id instead. Mongo also stops shipping them over
// the wire from Atlas, so the query itself returns sooner.
const LIST_EXCLUDED_FIELDS = "-longDescription -url -priceOverridden -approved -listed -__v -_id"

// See utils/categoryPath.js — drops the three legacy fields from any tag that
// already carries its full path, which is ~1.4MB of this response.

// GET /api/products — return saved products (with optional filters)
export const getSavedProducts = async (req, res) => {
    try {
        const { category, subcategory, subsubcategory, path, search } = req.query
        // Only approved products reach shoppers — newly scraped ones wait in the
        // admin's queue at /admin/upcoming-products.
        // …and only products the supplier still lists somewhere (see
        // reconcileCatalogue). $ne, not true: never-reconciled docs have no field.
        const filter = { approved: true, listed: { $ne: false } }
        if (category && category !== "all") filter.category = category
        if (subcategory) filter.subcategory = subcategory
        if (subsubcategory) filter.subsubcategory = subsubcategory
        // `path` narrows to one node of the tree at ANY depth (the three params
        // above only reach level 3), matching that node and everything under it —
        // "…/apple/iphone-11-series" also answers for "…/iphone-11-series/iphone-11-6-1".
        // Anchored and segment-bounded so a node never matches a longer-named sibling.
        if (path) {
            const escaped = String(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            filter["categoryTags.path"] = { $regex: `^${escaped}(/|$)` }
        }
        if (search) filter.name = { $regex: search, $options: "i" }

        // Same read-time blocklist the categories/banners endpoints apply: the
        // blocked CATEGORIES were already hidden, but their products (Bulk Offer,
        // Stock Clearance, LCD Screens, HOTO) were still surfacing on the
        // homepage and /category/all.
        const products = (await Product.find(filter).select(LIST_EXCLUDED_FIELDS).lean())
            .filter((p) => !isBlockedProduct(p))
            .map(stripBlockedTags)
            .map(slimCategoryTags)

        // The catalogue only changes when a scrape lands and the admin
        // approves — a short shared cache lets a repeat visitor (and a second
        // visitor arriving right behind the first) skip the query altogether,
        // while stale-while-revalidate keeps the refresh off the critical path.
        // The approval queue bypasses this with a no-store refetch.
        res.set("Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300")
        res.status(200).json({ success: true, count: products.length, data: products })

        // Kick off the background scrape only now, after this read has already
        // gone out — not at server boot. Starting the scraper at the same instant
        // the frontend makes its first request used to pit this exact query
        // against the scraper's own bulkWrite traffic on Atlas.
        if (!autoScrapeTriggered && scrapeIntervalMs() > 0) {
            autoScrapeTriggered = true
            runScrapeAndSave()
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// GET /api/products/:id — return single product
export const getSingleProduct = async (req, res) => {
    try {
        const product = await Product.findOne({ id: req.params.id }).lean()
        if (!product) return res.status(404).json({ success: false, message: "Product not found" })

        // The approval gate has to hold here too, not just on the catalogue list:
        // this route is the ONLY thing /product/[id] needs to render, so without
        // this an unapproved product was fully readable by anyone who had its id
        // (the scrape source's own product ids, which are guessable). Admins still
        // get it, so the admin can preview an item before approving it.
        // 404 rather than 403 — a shopper shouldn't learn the product exists.
        const isStaff = req.user?.role === "admin" || req.user?.role === "very-admin"
        if ((!product.approved || product.listed === false) && !isStaff) {
            return res.status(404).json({ success: false, message: "Product not found" })
        }

        // Product pages hit this for every product opened (it is the only source of
        // longDescription), so let the browser reuse it on a back-and-forth. An
        // admin's view is private: it can include a product no one else may see,
        // which must never land in a shared cache.
        res.set("Cache-Control", isStaff ? "private, no-store" : "public, max-age=60, stale-while-revalidate=300")
        res.status(200).json({ success: true, data: product })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// PATCH /api/products/:id/price — admin-only manual price override. Accepts
// `price` (current) and optionally `originalPrice` (the crossed-out old price
// scraped from the source site). priceOverridden is recorded as a marker of admin
// intent; the price is safe from rescrapes regardless, because the scraper writes
// price only on a product's first insert (see scrapePersistence.js).
export const updateProductPrice = async (req, res) => {
    try {
        const set = { priceOverridden: true }

        if (req.body.price !== undefined) {
            const price = Number(req.body.price)
            if (!Number.isFinite(price) || price < 0) {
                return res.status(400).json({ success: false, message: "price must be a non-negative number" })
            }
            set.price = price
        }

        if (req.body.originalPrice !== undefined) {
            const originalPrice = Number(req.body.originalPrice)
            if (!Number.isFinite(originalPrice) || originalPrice < 0) {
                return res.status(400).json({ success: false, message: "originalPrice must be a non-negative number" })
            }
            set.originalPrice = originalPrice
        }

        if (set.price === undefined && set.originalPrice === undefined) {
            return res.status(400).json({ success: false, message: "Provide price and/or originalPrice" })
        }

        const product = await Product.findOneAndUpdate(
            { id: req.params.id },
            { $set: set },
            { new: true }
        ).lean()
        if (!product) return res.status(404).json({ success: false, message: "Product not found" })

        res.status(200).json({ success: true, data: product })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// PATCH /api/products/:id/stock — admin-only stock edit.
//   { stock: N }              sets the units (0 = out of stock) and marks the stock
//                             as the admin's, so no scrape overwrites it.
//   { followSupplier: true }  hands stock back to the scraper; the next run
//                             refreshes it from the supplier.
export const updateProductStock = async (req, res) => {
    try {
        let set
        if (req.body.followSupplier === true) {
            set = { stockOverridden: false }
        } else {
            const stock = Number(req.body.stock)
            if (!Number.isInteger(stock) || stock < 0) {
                return res.status(400).json({ success: false, message: "stock must be a whole number, 0 or more" })
            }
            set = { stock, stockOverridden: true }
        }

        const product = await Product.findOneAndUpdate({ id: req.params.id }, { $set: set }, { new: true }).lean()
        if (!product) return res.status(404).json({ success: false, message: "Product not found" })

        res.status(200).json({ success: true, data: product })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// ── Very-admin: approval queue + permanent delete ────────────────────────────

// GET /api/pending — everything still waiting on the admin, in two lists.
export const getPendingItems = async (req, res) => {
    try {
        const [products, banners] = await Promise.all([
            Product.find({ approved: { $ne: true } }).sort({ createdAt: -1, _id: -1 }).lean(),
            Banner.find({ approved: { $ne: true } }).sort({ order: 1 }).lean(),
        ])
        res.status(200).json({
            success: true,
            data: {
                products: products.filter((p) => !isBlockedProduct(p)).map(stripBlockedTags),
                banners: banners.filter((b) => !isBlockedBanner(b)),
            },
        })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// PATCH /api/products/:id/approve — publish one product to the storefront.
export const approveProduct = async (req, res) => {
    try {
        const product = await Product.findOneAndUpdate(
            { id: req.params.id },
            { $set: { approved: true } },
            { new: true }
        ).lean()
        if (!product) return res.status(404).json({ success: false, message: "Product not found" })
        res.status(200).json({ success: true, data: product })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// PATCH /api/banners/:id/approve — publish one banner to the hero slider.
export const approveBanner = async (req, res) => {
    try {
        const banner = await Banner.findByIdAndUpdate(
            req.params.id,
            { $set: { approved: true } },
            { new: true }
        ).lean()
        if (!banner) return res.status(404).json({ success: false, message: "Banner not found" })
        res.status(200).json({ success: true, data: banner })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// DELETE /api/products/:id — permanent. The document goes, and a DeletedProduct
// tombstone stays behind so no future scrape can bring the product back.
export const deleteProduct = async (req, res) => {
    try {
        const product = await Product.findOneAndDelete({ id: req.params.id }).lean()

        // The tombstone is written even when no product matched: an id can be
        // deleted while a scrape is mid-flight, and the tombstone is what stops
        // that run's pending write from resurrecting it.
        await DeletedProduct.updateOne(
            { id: req.params.id },
            { $set: { id: req.params.id, name: product?.name || "", deletedAt: new Date() } },
            { upsert: true }
        )

        if (!product) return res.status(404).json({ success: false, message: "Product not found" })
        res.status(200).json({ success: true, data: { id: product.id } })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// GET /api/categories — return saved categories. Blocklist is applied on read
// too, so categories persisted by an older scrape disappear immediately without
// waiting for the next scrape to rewrite the collection.
export const getCategories = async (req, res) => {
    try {
        // Sorted by the source sidebar's own top-to-bottom position so the
        // storefront sidebar (and its section headings) sequence matches mobigo.
        const categories = await Category.find().sort({ order: 1, _id: 1 }).lean()
        // The sidebar tree only changes when a scrape rewrites it.
        res.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600")
        res.status(200).json({
            success: true,
            data: categories
                .filter((c) => !isBlockedCategoryName(c.name))
                // Blocked nodes are pruned at every depth, not just the top level —
                // a removed subcategory has to disappear from the sidebar and from
                // the listing page's sub-category row the moment it is blocked,
                // without waiting for the next scrape to rewrite the collection.
                .map(pruneBlockedCategoryNodes)
                .map((c) => ({ ...c, name: displayCategoryName(c.name) })),
        })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// GET /api/banners — return saved hero banners, ordered for the homepage slider.
// Same read-time blocklist as categories (girls banner, HOTO banners).
export const getBanners = async (req, res) => {
    try {
        const banners = await Banner.find({ approved: true }).sort({ order: 1 }).lean()
        res.status(200).json({ success: true, data: banners.filter((b) => !isBlockedBanner(b)) })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}
