import { Banner } from "../models/Banner.js"
import { Category } from "../models/Category.js"
import { Product } from "../models/Product.js"
import { DeletedProduct } from "../models/DeletedProduct.js"
import {
    isBlockedCategoryName,
    isBlockedCategorySlug,
    isBlockedProduct,
    isBlockedProductName,
    isJunkTitle,
    JUNK_TITLE_RE,
    pruneBlockedCategoryNodes,
} from "./blocklist.js"
import { categoryTagPath, productCategoryPaths } from "./categoryPath.js"

// ── Product text is write-once ────────────────────────────────────────────────
//
// The store shows a product's title, description and brand from OUR database,
// and no crawl may change them once they are there — the same rule as price. On
// 2026-10-01 the crawl's habit of re-copying the supplier's current text onto
// every product is what put "Just a moment..." (a Cloudflare page title) on 4698
// product cards. A scraped value is used only where the field is still unset:
// missing, empty, or holding a block-page title (so a damaged name heals itself).
const isUnsetText = (field) => ({
    $or: [
        { $eq: [{ $ifNull: [`$${field}`, ""] }, ""] },
        { $regexMatch: { input: { $toString: { $ifNull: [`$${field}`, ""] } }, regex: JUNK_TITLE_RE.source, options: "i" } },
    ],
})
const keepText = (field, scraped) => ({ $cond: [isUnsetText(field), { $literal: scraped ?? "" }, `$${field}`] })
const isUnsetValue = (v) => !String(v ?? "").trim() || isJunkTitle(v)

// ── Admin deletions are permanent, enforced HERE ──────────────────────────────
//
// A product the admin deletes must never come back, even if the supplier still
// lists it and even if the supplier changes it. That rule used to be enforced
// only by each CALLER remembering to seed its skip-set from DeletedProduct
// (runScrapeAndSave does; the old wipe-and-reinsert scrapeNow.js did not), which
// is why two admin-deleted screwdriver sets were found sitting in the collection,
// re-inserted about two hours after they were deleted.
//
// So the guard now lives in the only function that writes products. A caller can
// forget its skip-set; it cannot get past this.
//
// Cached because saveProductBatch runs once per category node — hundreds of times
// per crawl — and re-querying 209 tombstones each time would be pure overhead.
// The short TTL bounds how stale the set can be when the admin deletes something
// while a scrape is mid-flight.
const TOMBSTONE_TTL_MS = 30000
let tombstoneIds = null
let tombstoneLoadedAt = 0
let tombstoneInflight = null

async function loadTombstonedIds() {
    if (tombstoneIds && Date.now() - tombstoneLoadedAt < TOMBSTONE_TTL_MS) return tombstoneIds
    if (!tombstoneInflight) {
        tombstoneInflight = (async () => {
            const docs = await DeletedProduct.find({}, { id: 1 }).lean()
            tombstoneIds = new Set(docs.map((d) => d.id))
            tombstoneLoadedAt = Date.now()
            return tombstoneIds
        })().finally(() => {
            tombstoneInflight = null
        })
    }
    // Deliberately no catch: if the tombstone list cannot be read, the batch is
    // not written. Failing closed keeps a deleted product deleted; failing open
    // would silently restore it.
    return tombstoneInflight
}

// Merges one level of the tree: every freshly scraped node (fresh label/url,
// fresh order), each with its children merged the same way, then every node the
// stored tree had that this scrape did not return, kept as it was.
function mergeCategoryItems(fresh = [], stored = []) {
    const storedBySlug = new Map(stored.filter((n) => n?.slug).map((n) => [n.slug, n]))
    const merged = fresh.map((n) => {
        const old = storedBySlug.get(n.slug)
        return old ? { ...n, items: mergeCategoryItems(n.items, old.items) } : n
    })
    const freshSlugs = new Set(fresh.map((n) => n.slug))
    for (const old of stored) {
        if (old?.slug && !freshSlugs.has(old.slug)) merged.push(old)
    }
    return merged
}

// The tree is MERGED into what is stored, never replaced. It used to be a
// deleteMany + insertMany of whatever this run scraped — and the deep levels 4-6
// come from hundreds of category-page reads that die with Chrome: on 2026-09-23 a
// run whose browser crashed twice during that expansion rewrote the sidebar from
// 826 nodes to 790, dropping Galaxy S24/S25/S26 and others the supplier still
// has. So a run may add categories and refresh names/links/order, but a node it
// did not see stays. Blocked categories are pruned from the result either way.
// A category the supplier genuinely retires has to be removed by hand.
export async function saveCategories(categories) {
    // Refuse to touch the tree on an empty result — a failed nav scrape or a
    // logged-out session.
    if (!categories?.length) {
        console.warn(`[scrape] ⚠ nav scrape returned no categories — keeping the existing tree untouched`)
        return
    }
    const stored = await Category.find({}).sort({ order: 1 }).lean()
    const storedBySlug = new Map(stored.map((c) => [c.slug, c]))
    const merged = categories.map((c) => {
        const old = storedBySlug.get(c.slug)
        return old ? { ...c, items: mergeCategoryItems(c.items, old.items) } : c
    })
    const freshSlugs = new Set(categories.map((c) => c.slug))
    let nextOrder = Math.max(0, ...categories.map((c) => c.order ?? 0)) + 1
    for (const old of stored) {
        if (freshSlugs.has(old.slug) || isBlockedCategoryName(old.name)) continue
        const { _id, __v, ...rest } = old
        merged.push({ ...rest, order: nextOrder++ })
    }
    const pruned = merged.map((c) => pruneBlockedCategoryNodes(c))

    await Category.deleteMany()
    await Category.insertMany(pruned)
}

// Banners are wiped and reinserted each run, so the admin's approvals have
// to be carried across by image URL — otherwise every scrape would knock the
// whole hero slider back to unapproved.
export async function saveBanners(banners) {
    // Same rule as saveCategories: an empty result must not empty the slider.
    if (!banners?.length) {
        console.warn(`[scrape] ⚠ banner scrape returned nothing — keeping the existing banners untouched`)
        return
    }
    const approvedImages = new Set(
        (await Banner.find({ approved: true }, { image: 1 }).lean()).map((b) => b.image)
    )
    await Banner.deleteMany()
    await Banner.insertMany(banners.map((b) => ({ ...b, approved: approvedImages.has(b.image) })))
}

// Merges one category placement into a product that is ALREADY in the DB, and
// touches nothing else — no price, no stock, no description, no images.
//
// The crawl reaches every product under every node on every run, including the
// levels 4-6 the sidebar never showed and the crawler therefore never visited
// before. Those nodes have to be able to fill up from the 6000 products already
// stored, so an incremental run can't just skip a known product outright the way
// it used to: it skips the expensive part (re-saving and re-enriching it) and
// still records where it was found. $setUnion makes the write idempotent, so
// every later run over the same node is a no-op.
//
// No upsert: a product missing here was permanently deleted by the admin
// (its id is seeded into the skip-set from DeletedProduct), and a tag merge must
// never be what brings it back.
const tagMergeOp = ({ product, tag }) => ({
    updateOne: {
        filter: { id: product.id },
        update: [{ $set: { categoryTags: { $setUnion: [{ $ifNull: ["$categoryTags", []] }, [tag]] } } }],
    },
})

// Upserts one crawl batch (a category node's worth of products, typically a
// handful up to ~40). Uses a pipeline update so, in a single atomic write per
// product, we can:
//   - insert the full document the first time a product is ever seen,
//   - refresh every field on later runs,
//   - EXCEPT price/originalPrice, which are WRITE-ONCE: set when the product is
//     first inserted and never written again, for every product, regardless of
//     priceOverridden. This is not the old rule — it used to key off that flag,
//     which 224 of 7110 products did not carry, so those were being reset to the
//     supplier's wholesale figure on every single run. `priceOverridden` is now
//     only a record of admin intent (dedupeProducts.js reads it to pick which
//     duplicate to keep); it is NOT what protects the price. Do not "restore" the
//     conditional.
//   - merge this batch's category tag into categoryTags without clobbering tags
//     added by a different batch (cross-listed products appear in many nodes),
//   - only set the primary category/subcategory/subsubcategory the first time
//     this run sees the product, mirroring the original first-seen-wins behavior.
export async function saveProductBatch(batch) {
    // Name-blocklisted products (screws/screwdrivers, any brand) are dropped here
    // rather than written and filtered out again on every read. The read APIs still
    // apply the same rule, which is what hides the ones earlier scrapes already saved.
    const notBlocked = batch.filter(({ product }) => !isBlockedProductName(product?.name))
    if (notBlocked.length !== batch.length) {
        console.log(`[scrape] ⛔ skipped ${batch.length - notBlocked.length} blocklisted product(s)`)
    }

    // Admin-deleted products are dropped before anything is written — see the
    // note at the top of this file. Applies to tag-only entries too: there is no
    // reason to touch a document the admin removed.
    const tombstoned = await loadTombstonedIds()
    const allowed = notBlocked.filter(({ product }) => !tombstoned.has(product?.id))
    if (allowed.length !== notBlocked.length) {
        console.log(
            `[scrape] 🪦 skipped ${notBlocked.length - allowed.length} product(s) the admin deleted (staying deleted)`
        )
    }

    // A product with no readable price must not be written. Now that price is
    // write-once (see below), a document inserted at 0 keeps that 0 for the rest
    // of its life — no later crawl will correct it — so a single category page
    // that renders without its price elements would put permanently free products
    // on the storefront, and the bulk-approval workflow would publish them. A
    // tag-only entry carries no price at all and is unaffected.
    const writable = allowed.filter((entry) => {
        if (entry.tagOnly) return true
        const price = Number(entry.product?.price)
        return Number.isFinite(price) && price > 0
    })
    if (writable.length !== allowed.length) {
        const dropped = allowed.length - writable.length
        console.warn(
            `[scrape] ⚠ ${dropped} product(s) had no readable price and were NOT written ` +
                `(a priceless insert would be frozen at 0 forever). They will be picked up by a later run.`
        )
    }
    if (!writable.length) return writable

    const now = new Date().toISOString()
    const ops = writable.map((entry) => {
        if (entry.tagOnly) return tagMergeOp(entry)
        const { product, tag, isFirstSeen, sparse } = entry
        // A `sparse` record came off the source's old listing template, which prints
        // only a name, link and price — no thumbnail and no stock line. Writing its
        // blanks would wipe the image and stock a richer page already gave the same
        // product, so those two fields are preserved instead of overwritten.
        const images = sparse ? { $ifNull: ["$images", []] } : product.images
        // Stock the admin set by hand is theirs until they hand it back — see
        // stockOverridden in models/Product.js.
        const stock = {
            $cond: [{ $eq: ["$stockOverridden", true] }, "$stock", sparse ? { $ifNull: ["$stock", 0] } : product.stock],
        }
        return {
            updateOne: {
                filter: { id: product.id },
                update: [
                    {
                        $set: {
                            id: product.id,
                            // TEXT IS WRITE-ONCE, like price below: what our database
                            // holds is what the store shows, and a crawl only fills a
                            // field that is still empty (or a block-page title).
                            name: keepText("name", product.name),
                            brand: keepText("brand", product.brand),
                            manufacturer: keepText("manufacturer", product.brand),
                            description: keepText("description", product.description),
                            images,
                            stock,
                            productCode: product.productCode,
                            url: product.url,
                            tags: {
                                $cond: [{ $gt: [{ $size: { $ifNull: ["$tags", []] } }, 0] }, "$tags", { $literal: product.tags ?? [] }],
                            },
                            rating: { $ifNull: ["$rating", product.rating] },
                            reviewCount: { $ifNull: ["$reviewCount", product.reviewCount] },
                            isNew: { $ifNull: ["$isNew", product.isNew] },
                            isSale: { $ifNull: ["$isSale", product.isSale] },
                            longDescription: { $ifNull: ["$longDescription", product.longDescription] },
                            createdAt: { $ifNull: ["$createdAt", now] },
                            priceOverridden: { $ifNull: ["$priceOverridden", false] },
                            // Pipeline updates bypass schema defaults, so the gate has
                            // to be written explicitly: false for a brand-new product,
                            // preserved for one the admin already approved.
                            approved: { $ifNull: ["$approved", false] },
                            // PRICE IS WRITE-ONCE. A product already in the store keeps
                            // the price it has, full stop — $ifNull only falls through to
                            // the scraped value when the field does not exist yet, which
                            // is exactly and only on the insert of a brand-new product.
                            //
                            // This deliberately no longer keys off priceOverridden. That
                            // flag was set on 6886 of 7110 products, so the 224 without it
                            // (batteries, bulk offers — priced correctly and so never
                            // hand-edited) were still being reset to the supplier's price
                            // on every run. The store's prices are a retail markup over
                            // the supplier's wholesale figure — live spot checks show
                            // €8.45 wholesale against €20 in the store — so overwriting
                            // one is silent margin loss, not a cosmetic change.
                            //
                            // New products still arrive at the supplier's own price, for
                            // the admin to mark up afterwards.
                            // Keyed on the field being genuinely ABSENT, which happens
                            // on an upsert-insert and nowhere else. $ifNull would also
                            // fire on an explicit null, so a repair script that nulled a
                            // bad price would silently re-arm the wholesale overwrite on
                            // the next crawl.
                            price: { $cond: [{ $eq: [{ $type: "$price" }, "missing"] }, product.price, "$price"] },
                            originalPrice: {
                                $cond: [{ $eq: [{ $type: "$originalPrice" }, "missing"] }, product.originalPrice, "$originalPrice"],
                            },
                            ...(isFirstSeen
                                ? { category: tag.category, subcategory: tag.subcategory, subsubcategory: tag.subsubcategory }
                                : {}),
                            categoryTags: { $setUnion: [{ $ifNull: ["$categoryTags", []] }, [tag]] },
                        },
                    },
                ],
                upsert: true,
            },
        }
    })

    await Product.bulkWrite(ops, { ordered: false })
    // The products that were actually ADDED, so the caller's progress count and
    // "new products" email digest mention neither the ones we dropped nor the ones
    // that were only re-tagged (already in the store, already announced).
    return writable.filter((entry) => !entry.tagOnly)
}

// ── What the supplier is allowed to change on a product we already store ──────
//
// Availability — and nothing else. Title and description are only FILLED when
// the product has none yet (a new product, or a damaged block-page title); text
// already in our database is never replaced (see keepText). Price is absent from
// this function by design, not by omission: the store's prices are the admin's
// and no scrape may write them.
//
// Returns a record of what ACTUALLY changed (or null), so a run can report "the
// supplier moved 412 products in or out of stock" instead of just claiming it
// finished. That reporting is the point of the whole pass: stock is
// the field that goes stale fastest, and nothing was previously refreshing it for
// the ~7100 products already in the collection.
//
// No upsert anywhere: a product that is not there (admin-deleted, tombstoned) is
// left alone and reported as untouched, never recreated.
export async function updateProductMeta({ id, name, description, longDescription, stock }) {
    const set = {}
    // A block-page title ("Just a moment...") is never a product name.
    if (typeof name === "string" && name.trim() && !isJunkTitle(name)) set.name = name.trim()
    if (typeof description === "string" && description.trim()) set.description = description
    if (typeof longDescription === "string" && longDescription.trim()) set.longDescription = longDescription
    if (typeof stock === "number" && Number.isFinite(stock) && stock >= 0) set.stock = stock
    if (!Object.keys(set).length) return null

    // A pipeline update, so stock can be skipped for a product whose stock the
    // admin set by hand without a second read. $literal keeps a scraped string
    // that happens to start with "$" from being read as a field path.
    //
    // Text only fills what is still unset (see keepText). The description pair
    // keys off longDescription, which only a detail page ever supplies — a new
    // product's `description` is just its name until then, so it is never "empty".
    const pipelineSet = {}
    if (set.name !== undefined) pipelineSet.name = keepText("name", set.name)
    const freshDescription = isUnsetText("longDescription")
    for (const k of ["description", "longDescription"]) {
        if (set[k] !== undefined) pipelineSet[k] = { $cond: [freshDescription, { $literal: set[k] }, `$${k}`] }
    }
    if (set.stock !== undefined) {
        pipelineSet.stock = { $cond: [{ $eq: ["$stockOverridden", true] }, "$stock", { $literal: set.stock }] }
    }

    // findOneAndUpdate with new:false hands back the pre-update document, so the
    // comparison costs no extra round trip.
    const before = await Product.findOneAndUpdate(
        { id },
        [{ $set: pipelineSet }],
        { new: false, projection: { name: 1, stock: 1, stockOverridden: 1, longDescription: 1, description: 1 } }
    ).lean()
    if (!before) return null

    const changes = { id }
    let any = false
    if (set.name !== undefined && isUnsetValue(before.name) && set.name !== before.name) {
        changes.name = { from: before.name ?? "", to: set.name }
        any = true
    }
    if (set.stock !== undefined && !before.stockOverridden && set.stock !== before.stock) {
        changes.stock = { from: before.stock ?? null, to: set.stock }
        any = true
    }
    if (set.longDescription !== undefined && isUnsetValue(before.longDescription) && set.longDescription !== (before.longDescription ?? "")) {
        changes.description = { hadOne: !!(before.longDescription || "").trim() }
        any = true
    }
    return any ? changes : null
}

// A product whose page has gone (a real supplier 404) is zeroed rather than
// deleted. Deleting is utils/syncSupplier.js's job and needs its own guards, but
// leaving a vanished product showing stock invites an order that can never be
// filled — so availability is corrected immediately and the rest of the document,
// including its price, is left exactly as it is.
export async function markProductUnavailable({ id }) {
    // Not over stock the admin set by hand — that is theirs to change.
    const before = await Product.findOneAndUpdate(
        { id, stockOverridden: { $ne: true } },
        { $set: { stock: 0 } },
        { new: false, projection: { stock: 1 } }
    ).lean()
    if (!before) return null
    return before.stock === 0 ? null : { id, stock: { from: before.stock ?? null, to: 0 } }
}

// ── Keeping category membership in step with the supplier ─────────────────────
//
// saveProductBatch only ever ADDS a placement ($setUnion), so a product the
// supplier took out of a category stayed in ours for good, and a product the
// supplier took out of EVERY category — its page still up, but listed nowhere —
// stayed on sale here with whatever stock it had when last seen, because the
// detail-page pass only visits products the crawl finds. Found live: mobigo's
// Galaxy S23 Ultra category lists 17 cases; ours showed 22, one of them "in
// stock (7 units)" that the supplier holds 0 of.
//
// This run's evidence is the only thing it acts on:
//   - A placement is dropped only if this run crawled THAT node, got the node's
//     full "We found N" count, and the product was not in it (crawl.verifiedPaths).
//     A node the crawl never reached — failed, skipped, missing from a tree that a
//     browser crash truncated, or blocked — proves nothing, so its placements stay.
//   - A product is hidden (listed:false) only when EVERY placement it had was
//     verified this way and it turned up nowhere, only on a COMPLETE crawl, and
//     the step aborts if it would hide more than MAX_UNLIST_FRACTION of the
//     catalogue. It reappears (listed:true) the next time a crawl sees it.
//   - Blocked products are skipped entirely, so no placement change can move one
//     out of a blocked primary category and back onto the storefront.
// Only categoryTags, the primary category fields and `listed` are ever written —
// never price, stock, approval, name or anything else — and nothing is deleted,
// so a wrong run is undone by the next good one.
const MAX_UNLIST_FRACTION = 0.1

const isBlockedPlacement = (t = {}) =>
    isBlockedCategorySlug(t.category) || isBlockedCategorySlug(t.subcategory) || isBlockedCategorySlug(t.subsubcategory)

const samePrimary = (t, p) =>
    t.category === p.category && t.subcategory === p.subcategory && (t.subsubcategory || "") === (p.subsubcategory || "")

export async function reconcileCatalogue({ products, crawl }) {
    const verified = new Set(crawl?.verifiedPaths ?? [])
    if (!verified.size) {
        return { skipped: "no category node was fully verified this run — category membership left as it was" }
    }

    const seen = new Map()
    for (const p of products ?? []) {
        if (!p?.id) continue
        const tags = seen.get(p.id) ?? []
        for (const t of p.categoryTags ?? []) {
            if (t?.path && !tags.some((x) => x.path === t.path)) tags.push(t)
        }
        seen.set(p.id, tags)
    }

    const stored = await Product.find(
        {},
        { id: 1, name: 1, categoryTags: 1, category: 1, subcategory: 1, subsubcategory: 1, listed: 1 }
    ).lean()

    const tagOps = []
    const retagged = []
    const toUnlist = []
    const toRelist = []

    for (const p of stored) {
        if (isBlockedProduct(p)) continue

        const oldTags = (p.categoryTags ?? []).map((t) => ({ ...t, path: categoryTagPath(t) }))
        const seenTags = seen.get(p.id) ?? []
        if (seenTags.length && p.listed === false) toRelist.push(p.id)

        // Old placements this run cannot vouch against are carried over as-is.
        const nextTags = [...seenTags]
        for (const t of oldTags) {
            if (!t.path || verified.has(t.path)) continue
            if (!nextTags.some((x) => x.path === t.path)) nextTags.push(t)
        }

        if (!seenTags.length) {
            // Found nowhere. If every placement it had was checked and it was in
            // none of them, it is a hide candidate; otherwise just drop the
            // placements that were checked.
            const paths = productCategoryPaths(p)
            if (!nextTags.length) {
                if (p.listed !== false && paths.length && paths.every((x) => verified.has(x))) toUnlist.push(p)
                continue
            }
        }

        const oldPaths = new Set(oldTags.map((t) => t.path))
        const nextPaths = new Set(nextTags.map((t) => t.path))
        const removed = [...oldPaths].filter((x) => x && !nextPaths.has(x))
        const added = [...nextPaths].filter((x) => !oldPaths.has(x))
        if (!removed.length && !added.length) continue

        const set = { categoryTags: nextTags }
        // Move the primary only when its own placement was one of the ones
        // removed, and never onto a blocked category.
        if (oldTags.some((t) => samePrimary(t, p)) && !nextTags.some((t) => samePrimary(t, p))) {
            const next = nextTags.find((t) => !isBlockedPlacement(t))
            if (next) {
                set.category = next.category
                set.subcategory = next.subcategory
                set.subsubcategory = next.subsubcategory || ""
            }
        }
        tagOps.push({ updateOne: { filter: { id: p.id }, update: { $set: set } } })
        if (removed.length) retagged.push({ id: p.id, name: p.name, removedFrom: removed, addedTo: added })
    }

    let unlistAborted = null
    if (toUnlist.length && !crawl?.complete) {
        unlistAborted = `crawl incomplete — ${toUnlist.length} delisted-looking products left visible until a complete run`
    } else {
        const limit = Math.floor(stored.length * MAX_UNLIST_FRACTION)
        if (toUnlist.length > limit) {
            unlistAborted =
                `${toUnlist.length} of ${stored.length} products would be hidden (limit ${limit}) — ` +
                `that looks like a broken crawl, not real delistings, so nothing was hidden`
        }
    }
    if (unlistAborted) console.warn(`[reconcile] ⚠ ${unlistAborted}`)

    const ops = [...tagOps]
    if (!unlistAborted && toUnlist.length) {
        ops.push({
            updateMany: { filter: { id: { $in: toUnlist.map((p) => p.id) } }, update: { $set: { listed: false } } },
        })
    }
    if (toRelist.length) {
        ops.push({ updateMany: { filter: { id: { $in: toRelist } }, update: { $set: { listed: true } } } })
    }
    for (let i = 0; i < ops.length; i += 500) {
        await Product.bulkWrite(ops.slice(i, i + 500), { ordered: false })
    }

    return {
        verifiedNodes: verified.size,
        retagged: tagOps.length,
        removedFromCategories: retagged,
        unlisted: unlistAborted ? [] : toUnlist.map((p) => ({ id: p.id, name: p.name })),
        relisted: toRelist,
        unlistAborted,
    }
}

export async function updateProductImages({ id, images }) {
    await Product.updateOne({ id }, { $set: { images } })
}

// Stock and description no longer have their own writers. They were separate
// updateOne calls per product — two round trips where one does — and neither
// reported what it had changed, so a run could not say what the supplier had
// actually done. updateProductMeta above replaces both and returns the diff.
