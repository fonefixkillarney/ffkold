import mongoose from "mongoose"

const categoryTagSchema = new mongoose.Schema(
    {
        category: String,
        subcategory: String,
        subsubcategory: { type: String, default: "" },
        // The FULL slug path of this placement, root first, slash-joined —
        // "mobile-cases-by-brand/apple/iphone-11-series/iphone-11-6-1". The three
        // fields above only reach level 3, which is as deep as mobigo's sidebar
        // goes; its category PAGES continue to level 6, so every node below level
        // 3 is only addressable through this. A listing filters by prefix: a tag
        // belongs to node P when its path === P or starts with P + "/".
        //
        // Tags written before this field existed have no path — readers derive one
        // from the three fields above (see categoryTagPath in utils/categoryPath.js)
        // so they keep working untouched, and the next scrape fills in the real one.
        path: { type: String, default: "" },
    },
    { _id: false }
)

const productSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: String,
    price: Number,
    originalPrice: Number,
    category: String,
    subcategory: String,
    subsubcategory: { type: String, default: "" },
    // A product can be cross-listed under many categories on mobigo.ie (e.g. a
    // speaker under both its brand page and "Stock Clearance"). categoryTags holds
    // every placement found — each carrying the full-depth `path` that the deep
    // category filters key off; category/subcategory/subsubcategory above stay as
    // the primary (first-seen) tag for breadcrumbs/display.
    categoryTags: [categoryTagSchema],
    brand: String,
    description: String,
    longDescription: String,
    images: [{ type: String }],
    stock: Number,
    rating: { type: Number, default: 4.0 },
    reviewCount: { type: Number, default: 0 },
    tags: [{ type: String }],
    isNew: { type: Boolean, default: false },
    isSale: { type: Boolean, default: false },
    manufacturer: String,
    productCode: String,
    url: String,
    createdAt: { type: String },
    // Set true once an admin manually edits the price. This is a RECORD OF INTENT,
    // not the thing that protects the price: the scraper writes price/originalPrice
    // once, on insert, and never again for any product (see scrapePersistence.js).
    // It used to be the gate, but 224 of 7110 products never carried the flag and
    // were being reset to wholesale on every run. utils/dedupeProducts.js reads it
    // to decide which of two duplicate documents the admin actually priced.
    priceOverridden: { type: Boolean, default: false },
    // Newly scraped products start unapproved and are invisible to shoppers until
    // the admin approves them at /admin/upcoming-products.
    approved: { type: Boolean, default: false },
    // Set once the admin edits stock by hand (units, or in/out of stock) on the
    // product page. While true, no scrape writes stock for this product — the
    // supplier refresh would otherwise undo the admin's figure on the next run.
    // The admin clears it with "Follow supplier stock".
    stockOverridden: { type: Boolean, default: false },
    // false = the supplier still has the product page but no longer lists it in
    // ANY category (a delisted item). Hidden from shoppers like an unapproved one.
    // Set/cleared only by reconcileCatalogue() after a COMPLETE crawl; absent on
    // products never reconciled, which count as listed.
    listed: { type: Boolean, default: true },
}, { suppressReservedKeysWarning: true })

// Every storefront read is "approved products, optionally narrowed to one
// category" — without this the catalogue endpoint scanned the whole collection on
// each cold request. The admin's queue ({ approved: { $ne: true } }) uses the
// same index from the other side.
productSchema.index({ approved: 1, category: 1 })

export const Product = mongoose.model("Product", productSchema)
