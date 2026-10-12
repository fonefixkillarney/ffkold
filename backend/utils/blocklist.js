// Central blocklist for categories and hero banners the storefront must never
// show. Used by the scraper (so future rescrapes drop them at the source) AND
// by the read APIs (so rows already sitting in MongoDB from older scrapes are
// filtered out without needing a fresh scrape).

// "Bulk Offer", "Stock Clearance", "LCD Screens / Batteries / Parts", "HOTO".
// Name-based (not slug/url) so it keeps working if mobigo reshuffles category
// ids. \b after hoto keeps "Hoco" (a different brand) safe.
const BLOCKED_CATEGORY_PATTERNS = [
    /bulk\s*offer/i,
    /stock\s*clearance/i,
    /lcd\s*screens?/i,
    /^\W*hoto\b/i,
]

export function isBlockedCategoryName(name = "") {
    return BLOCKED_CATEGORY_PATTERNS.some((re) => re.test(name))
}

// Individual category NODES the storefront must never show, addressed by their
// full slug path rather than by name.
//
// Path and not name because a label can legitimately exist in more than one
// branch: blocking "iPhone 6S/6" by name would also take out any Screen Protector
// or Tempered Glass node that happens to share it. A path names exactly one node,
// and blocking it takes its subtree with it.
//
// Enforced at both ends, like the name rules above — the scraper prunes them from
// the tree it builds, so no future run can bring them back or file products under
// them, and /api/categories prunes them on read, so nodes already in MongoDB
// disappear immediately without waiting for a rescrape.
const BLOCKED_CATEGORY_PATHS = new Set([
    // Discontinued Apple models. mobigo still lists these nodes but stocks nothing
    // for any of them, so the Apple dropdown offered six dead ends that every one
    // rendered "No results". Verified empty at the source, and none of these labels
    // exists anywhere else in the tree.
    "mobile-cases-by-brand/apple/iphone-4s-4",
    "mobile-cases-by-brand/apple/iphone-5c",
    "mobile-cases-by-brand/apple/iphone-6s-6",
    "mobile-cases-by-brand/apple/iphone-6s-6-plus",
    "mobile-cases-by-brand/apple/iphone-se-5s-5",
    "mobile-cases-by-brand/apple/ipod-touch-4th-5th-6th-generation",
])

export function isBlockedCategoryPath(path = "") {
    if (!path) return false
    if (BLOCKED_CATEGORY_PATHS.has(path)) return true
    // Everything under a blocked node is blocked with it.
    for (const blocked of BLOCKED_CATEGORY_PATHS) {
        if (path.startsWith(`${blocked}/`)) return true
    }
    return false
}

// Removes every blocked node from one top-level category's tree, at any depth.
// Returns the category untouched when nothing matched, so the ordinary case does
// not rebuild the tree.
export function pruneBlockedCategoryNodes(category) {
    if (!category?.slug) return category
    let changed = false

    const walk = (items, parentSlugs) => {
        const kept = []
        for (const item of items || []) {
            const slugs = [...parentSlugs, item.slug]
            if (isBlockedCategoryPath(slugs.join("/"))) {
                changed = true
                continue
            }
            kept.push({ ...item, items: walk(item.items, slugs) })
        }
        return kept
    }

    const items = walk(category.items, [category.slug])
    return changed ? { ...category, items } : category
}

// Individual products the storefront must never list, matched on the product NAME
// so the rule holds for every brand — the ones in the catalogue today are Hoco and
// HOTO, but a future scrape bringing in a third brand's is covered by the same
// pattern instead of needing another id added here.
//
// Screws: \bscrew catches "Screw", "Screws", "Screw Set", "Screwdriver" and
// "Screw Driver" in one go. The leading \b is what keeps unrelated words that
// merely end in those letters (corkscrew) out of it.
const BLOCKED_PRODUCT_PATTERNS = [/\bscrew/i]

export function isBlockedProductName(name = "") {
    return BLOCKED_PRODUCT_PATTERNS.some((re) => re.test(name))
}

// Products store category SLUGS ("bulk-offer"), not display names, so turn the
// slug back into spaced words and reuse the patterns above.
export function isBlockedCategorySlug(slug = "") {
    return isBlockedCategoryName(String(slug || "").replace(/-+/g, " "))
}

// A product is hidden outright when it is blocked by name, or when its PRIMARY
// category is blocked — that's the node it was first crawled under (e.g. the
// leftover "*BULK OFFER*" items still sitting in MongoDB from a scrape that
// predates the blocklist).
export function isBlockedProduct(product = {}) {
    return (
        isBlockedProductName(product.name) ||
        isBlockedCategorySlug(product.category) ||
        isBlockedCategorySlug(product.subcategory) ||
        isBlockedCategorySlug(product.subsubcategory)
    )
}

// Products that merely happen to be CROSS-LISTED in a blocked node (mobigo lists
// the same item under several categories) keep showing under their real category
// — only the blocked tags are dropped, so a blocked slug can't be reached through
// categoryTags either.
export function stripBlockedTags(product) {
    if (!Array.isArray(product?.categoryTags)) return product
    const tags = product.categoryTags.filter((t) => !isBlockedTag(t))
    return tags.length === product.categoryTags.length ? product : { ...product, categoryTags: tags }
}

// A placement is blocked when ANY node on its path is. The three legacy fields
// only cover the first three levels; `path` carries the rest, so a blocked node
// can't be reached through a level-4+ tag either.
function isBlockedTag(tag = {}) {
    if (
        isBlockedCategorySlug(tag?.category) ||
        isBlockedCategorySlug(tag?.subcategory) ||
        isBlockedCategorySlug(tag?.subsubcategory)
    ) {
        return true
    }
    // A placement pointing at a node that has been removed outright.
    if (isBlockedCategoryPath(tag?.path)) return true
    return String(tag?.path || "")
        .split("/")
        .some((slug) => isBlockedCategorySlug(slug))
}

// Hero banners to drop:
//  - the "girls" glitter-case banner (identified by its stable image filename)
//  - anything HOTO: matched dynamically by the scraper (banner link resolving
//    to a blocked category), plus these static fallbacks for rows already in
//    the DB — 3970 is HOTO's category id on mobigo.ie.
//  - the OX banner (matched by image filename, not by its 3494 link — the
//    category it points at stays live, so only this one artwork is dropped)
const BLOCKED_BANNER_IMAGES = [/1781544042383\.jpg$/i, /1769617022601\.jpg$/i]
const BLOCKED_BANNER_LINKS = [/category-s\/3970\.htm/i]

export function isBlockedBanner({ image = "", link = "", alt = "" } = {}) {
    return (
        BLOCKED_BANNER_IMAGES.some((re) => re.test(image)) ||
        BLOCKED_BANNER_LINKS.some((re) => re.test(link)) ||
        /hoto\b/i.test(alt)
    )
}

// Display-only renames. The category itself (and its slug, which every product
// stores as its `category`) is untouched — just the words the storefront prints.
// Applied on read so a rescrape can't reintroduce the source site's wording.
const CATEGORY_NAME_REWRITES = [
    [/^\s*OX\s*\/\s*/i, ""],
    // "Wallet Case From 1.00" -> "Wallet Cases". The supplier prices its menu
    // label; ours is a plain category button, and that figure goes stale. Matched
    // as a pattern rather than as that one exact string so the rename survives the
    // supplier re-wording it ("Wallet Cases From 2.00", "Wallet Case From EUR 1")
    // on a rescrape — which is the whole reason it lives here and not in the DB.
    [/^\s*wallet\s+cases?\s*(?:from\b.*)?$/i, "Wallet Cases"],
]

export function displayCategoryName(name = "") {
    return CATEGORY_NAME_REWRITES.reduce((out, [re, to]) => out.replace(re, to), String(name)).trim()
}

// Titles of pages that are NOT the product: Cloudflare's anti-bot interstitial
// ("Just a moment..." — served when the detail pass requests pages too fast), the
// supplier's logged-out landing page, and its 404 body. A detail-page read that
// lands on one of these has no real title to offer, and saving it as the name is
// how 4698 products came to be called "Just a moment..." on 2026-10-01. The same
// pattern is enforced as a validator on the products collection
// (utils/repairJunkNames.js), so a write that slips past this check still fails.
export const JUNK_TITLE_RE =
    /^\s*(just a moment|attention required|checking your browser|mobigo is the ireland|the page cannot be found)/i

export function isJunkTitle(title = "") {
    return JUNK_TITLE_RE.test(String(title))
}
