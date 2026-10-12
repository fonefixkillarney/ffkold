/**
 * Collapse duplicate product documents — the same supplier product stored more
 * than once, under different ids.
 *
 *   node utils/dedupeProducts.js            # DRY RUN — shows what it would keep/remove
 *   node utils/dedupeProducts.js --apply    # collapse them
 *
 * ─── Where the duplicates came from ─────────────────────────────────────────────
 *
 * A product's id was derived from its listing tile: the code in a
 * `/product-p/CODE.htm` URL, else the code in an "add to cart" ProductCode= link,
 * else — if the tile offered neither — a PER-RUN COUNTER, `prod-000123`, handed
 * out in crawl order.
 *
 * That last branch is the bug. Some listing templates write the product URL as
 * `/iPhone-7-Matte-Rose-Gel-Case-p/15100070101004.htm`, which the `/product-p/`
 * pattern does not match, and carry no ProductCode= link either. Those products
 * therefore drew a counter id, and the counter restarts every crawl — so each run
 * assigned the same product a different id, saw that id as unknown, and inserted
 * it AGAIN as a brand-new product. Repeated over many runs that left 74 redundant
 * documents across 8 URLs, one product held 11 times.
 *
 * And because every one of those re-inserts is an INSERT, it arrived at the
 * supplier's wholesale price rather than the admin's retail one. The same iPhone
 * case ended up on the storefront at €15, €10 and €5 simultaneously, and a shopper
 * could simply pick the cheapest copy. That is the reason this is worth cleaning
 * up rather than leaving alone.
 *
 * The cause is fixed in utils/srapper.js: a product is now recognised by its URL
 * against what is already stored, and the last-resort id is derived from the URL
 * instead of a counter, so no further duplicates can be created. This script
 * clears out the ones already there.
 *
 * ─── What it keeps ──────────────────────────────────────────────────────────────
 *
 * Documents are grouped by normalized URL — the same URL is the same supplier
 * product, so this can never merge two genuinely different products. Within a
 * group the survivor is chosen in this order:
 *
 *   1. priceOverridden   — the copy the admin actually priced
 *   2. approved          — the copy that is live on the storefront
 *   3. the highest price — retail beats an un-marked-up wholesale re-insert
 *   4. a canonical id    — a supplier product code, not a `prod-`/`u-` fallback
 *   5. the oldest createdAt — the original document
 *
 * Price sits ABOVE the id shape on purpose: ranking the canonical id first would
 * keep a €10 canonical document and delete a €15 copy of the same product, which
 * is a silent margin cut.
 *
 * The survivor's own price is never modified. It does absorb the union of every
 * duplicate's categoryTags, so collapsing a group cannot drop a category
 * placement and make the product vanish from a listing page.
 *
 * Removed documents are written to a timestamped JSON backup first, and no
 * DeletedProduct tombstone is created (a tombstone would block the id forever).
 */
import dotenv from "dotenv"
dotenv.config()

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import mongoose from "mongoose"
import { Product } from "../models/Product.js"
import { normalizeProductUrl } from "./srapper.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const apply = args.includes("--apply")

const isFallbackId = (id) => /^(prod-\d+|u-)/i.test(id || "")

// Highest score wins, compared element by element. Ordered so that the admin's
// own work always beats a machine-inserted copy.
//
// PRICE OUTRANKS ID SHAPE, deliberately. With the canonical-id flag ahead of
// price, a group could keep the €10 canonical document and delete a €15 copy —
// which is a silent margin cut, and this whole change exists to stop prices
// moving without the admin asking. The copies in a group are the same supplier
// product, so the highest price among them is the one the admin most recently
// marked up; a wholesale re-insert is always the cheaper one.
function score(p) {
    return [
        p.priceOverridden === true ? 1 : 0,
        p.approved === true ? 1 : 0,
        typeof p.price === "number" ? p.price : 0,
        isFallbackId(p.id) ? 0 : 1,
    ]
}
function better(a, b) {
    const sa = score(a)
    const sb = score(b)
    for (let i = 0; i < sa.length; i++) {
        if (sa[i] !== sb[i]) return sa[i] > sb[i] ? a : b
    }
    // Tie-break on age: the original document, not a later re-insert.
    return (a.createdAt || "") <= (b.createdAt || "") ? a : b
}

await mongoose.connect(process.env.MONGO_URI)
console.log(`\n${apply ? "APPLY" : "DRY RUN"} — collapse duplicate products`)
console.log(`MongoDB connected: ${mongoose.connection.host}\n`)

const total = await Product.countDocuments()
const all = await Product.find(
    {},
    { id: 1, name: 1, url: 1, price: 1, approved: 1, priceOverridden: 1, createdAt: 1, categoryTags: 1, stock: 1 }
).lean()

// Group by normalized URL. Documents with no URL are left strictly alone —
// without a URL there is no evidence two of them are the same product.
const groups = new Map()
let noUrl = 0
for (const p of all) {
    const key = normalizeProductUrl(p.url)
    if (!key) {
        noUrl++
        continue
    }
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
}

const dupeGroups = [...groups.entries()].filter(([, docs]) => docs.length > 1)
const toRemove = []
const decisions = []

for (const [url, docs] of dupeGroups) {
    const keep = docs.reduce(better)
    const drop = docs.filter((d) => d.id !== keep.id)
    // Union of every placement in the group, deduped by full path.
    const seen = new Set()
    const mergedTags = []
    for (const d of docs) {
        for (const t of d.categoryTags || []) {
            const k = t.path || `${t.category}/${t.subcategory}/${t.subsubcategory}`
            if (seen.has(k)) continue
            seen.add(k)
            mergedTags.push(t)
        }
    }
    decisions.push({
        url,
        name: keep.name,
        keep: { id: keep.id, price: keep.price, approved: !!keep.approved, overridden: !!keep.priceOverridden },
        drop: drop.map((d) => ({ id: d.id, price: d.price, approved: !!d.approved, overridden: !!d.priceOverridden })),
        tagsBefore: (keep.categoryTags || []).length,
        tagsAfter: mergedTags.length,
        mergedTags,
        keepId: keep.id,
    })
    toRemove.push(...drop.map((d) => d.id))
}

console.log(`products in store           : ${total}`)
console.log(`documents with no URL       : ${noUrl} (untouched)`)
console.log(`URLs stored more than once  : ${dupeGroups.length}`)
console.log(`redundant documents         : ${toRemove.length}`)

if (!dupeGroups.length) {
    console.log(`\nno duplicates — nothing to do.`)
    await mongoose.disconnect()
    process.exit(0)
}

console.log(`\n──────── PER GROUP ────────`)
for (const d of decisions) {
    console.log(`\n${(d.name || "").slice(0, 66)}`)
    console.log(`  ${d.url.slice(0, 74)}`)
    console.log(
        `  KEEP   ${d.keep.id.padEnd(18)} €${String(d.keep.price).padEnd(7)} ` +
            `${d.keep.overridden ? "admin-priced" : "not-priced"}${d.keep.approved ? ", live" : ""}`
    )
    for (const x of d.drop) {
        console.log(
            `  remove ${x.id.padEnd(18)} €${String(x.price).padEnd(7)} ` +
                `${x.overridden ? "admin-priced" : "not-priced"}${x.approved ? ", live" : ""}` +
                `${x.price !== d.keep.price ? "   ← different price" : ""}`
        )
    }
    if (d.tagsAfter > d.tagsBefore) console.log(`  categoryTags ${d.tagsBefore} -> ${d.tagsAfter} (absorbed from duplicates)`)
}

// Nearly every duplicate here carries priceOverridden, because the admin has been
// hand-pricing the copies too — so "an admin-priced copy is being removed" is the
// normal case and flagging it would be noise. What actually deserves a second look
// is a group whose copies disagree on PRICE, since collapsing it decides which
// price the storefront keeps.
const contested = decisions.filter((d) => d.drop.some((x) => x.price !== d.keep.price))
if (contested.length) {
    console.log(`\n⚠ ${contested.length} group(s) hold copies at DIFFERENT prices — collapsing decides which price survives:`)
    for (const d of contested) {
        const others = [...new Set(d.drop.map((x) => x.price).filter((v) => v !== d.keep.price))]
        console.log(`   ${(d.name || "").slice(0, 46)} — keeping €${d.keep.price}, dropping copies at €${others.join(", €")}`)
    }
    console.log(`   The survivor is the admin-priced, approved, HIGHEST-priced copy; its own price is not modified.`)
}

if (!apply) {
    console.log(`\nDRY RUN — nothing changed. Re-run with --apply to remove ${toRemove.length} redundant documents.`)
    console.log(`No surviving product's price is modified by this operation.`)
    await mongoose.disconnect()
    process.exit(0)
}

// Back up first — this is the only copy of what gets removed.
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const backupPath = path.join(__dirname, "..", `deduped-products-${stamp}.json`)
const fullDocs = await Product.find({ id: { $in: toRemove } }).lean()
fs.writeFileSync(backupPath, JSON.stringify(fullDocs, null, 2))
console.log(`\nbacked up ${fullDocs.length} documents to ${path.basename(backupPath)}`)

// Merge tags onto each survivor before removing its duplicates, so a placement is
// never lost in between.
let tagged = 0
for (const d of decisions) {
    if (d.tagsAfter > d.tagsBefore) {
        await Product.updateOne({ id: d.keepId }, { $set: { categoryTags: d.mergedTags } })
        tagged++
    }
}
if (tagged) console.log(`merged categoryTags onto ${tagged} surviving products`)

const res = await Product.deleteMany({ id: { $in: toRemove } })
console.log(`✅ removed ${res.deletedCount} redundant documents`)
console.log(`   products in store: ${total} -> ${await Product.countDocuments()}`)
console.log(`   prices changed: 0`)

await mongoose.disconnect()
process.exit(0)
