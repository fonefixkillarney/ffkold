// The category tree is up to 6 levels deep (mobigo's sidebar shows 3; its
// category pages continue past that), so a placement is addressed by its full
// slug PATH rather than by the three fixed category/subcategory/subsubcategory
// fields. Everything that reads or writes a path goes through here so the
// scraper, the read API and the blocklist can't drift apart on the format.
//
// Format: root-first slugs joined with "/" —
//   "mobile-cases-by-brand/apple/iphone-11-series/iphone-11-6-1"

export const PATH_SEP = "/"

export const joinCategoryPath = (slugs = []) => slugs.filter(Boolean).join(PATH_SEP)

export const splitCategoryPath = (path = "") => String(path || "").split(PATH_SEP).filter(Boolean)

// The path of one categoryTag. Tags written before `path` existed only have the
// three legacy fields, so derive it from those: level-1 placements were stored
// with subcategory === category (the scraper's own convention for "the products
// sitting directly on this category"), which collapses back to a single segment.
export function categoryTagPath(tag = {}) {
    if (tag.path) return tag.path
    const { category = "", subcategory = "", subsubcategory = "" } = tag
    if (!category) return ""
    const rest = subcategory && subcategory !== category ? [subcategory, subsubcategory] : []
    return joinCategoryPath([category, ...rest])
}

// Every placement a product has, as paths. Falls back to the product's own
// primary fields for documents that predate categoryTags entirely.
export function productCategoryPaths(product = {}) {
    const tags = product.categoryTags?.length
        ? product.categoryTags
        : [{ category: product.category, subcategory: product.subcategory, subsubcategory: product.subsubcategory }]
    return tags.map(categoryTagPath).filter(Boolean)
}

// Is `path` at, or below, node `prefix`? Compared on whole segments so
// "iphone-11" never matches the sibling node "iphone-11-pro".
export function isPathUnder(path = "", prefix = "") {
    if (!prefix) return true
    return path === prefix || path.startsWith(prefix + PATH_SEP)
}

// Reduces a product's placements to the one thing the storefront filters on: the
// set of distinct paths. Two kinds of waste come out.
//
// First, a tag's category/subcategory/subsubcategory are literally the first three
// segments of its own path written out again. Second, a product carries BOTH the
// tags earlier scrapes wrote (which have no path) and the path-carrying tag the
// same placement was re-crawled into — deliberately, so a transient crawl failure
// can never erase a placement, but they describe the same node twice.
//
// Harmless per document; the catalogue endpoint ships ~28000 tags at once, where
// it is over 2MB of what every visitor downloads. Deriving each tag's path first
// means the legacy ones collapse onto their modern twins instead of being trusted
// or dropped blindly. Mongo projections can't reshape inside an array, so this
// runs on the way out; /api/products/:id still returns whole documents.
export function slimCategoryTags(product) {
    if (!Array.isArray(product?.categoryTags)) return product
    const paths = new Set()
    for (const tag of product.categoryTags) {
        const path = categoryTagPath(tag)
        if (path) paths.add(path)
    }
    return { ...product, categoryTags: [...paths].map((path) => ({ path })) }
}

// Builds the tag a crawled node writes onto its products. The three legacy
// fields are still filled in — the storefront's breadcrumbs, the blocklist and
// the /api/products category filters all still read them — with `path` carrying
// the full depth on top.
export function categoryTagFor(pathSlugs = []) {
    const [category = "", subcategory = "", subsubcategory = ""] = pathSlugs
    return {
        category,
        subcategory: subcategory || category,
        subsubcategory,
        path: joinCategoryPath(pathSlugs),
    }
}
