/**
 * Re-apply the admin's deletions — remove any product that is sitting in the
 * catalogue despite having a DeletedProduct tombstone.
 *
 *   node utils/enforceTombstones.js            # DRY RUN — lists what came back
 *   node utils/enforceTombstones.js --apply    # delete them again
 *
 * ─── Why this is needed ─────────────────────────────────────────────────────────
 *
 * A product the admin deletes is meant to stay deleted permanently, even if the
 * supplier still lists it. The mechanism is a tombstone in `DeletedProduct`, and
 * it worked by every CALLER of the scraper remembering to seed its skip-set from
 * that collection. `runScrapeAndSave` did. The old `utils/scrapeNow.js` did not —
 * it ran `Product.deleteMany()` followed by `insertMany(scrapedProducts)`, which
 * bypassed the skip-set entirely and restored every deleted product the supplier
 * still carried.
 *
 * Two products were found in exactly that state (both Hoco screwdriver sets),
 * re-inserted about two hours after they were deleted.
 *
 * The hole itself is now closed in two places: scrapeNow.js no longer wipes and
 * reinserts, and — the part that actually guarantees it — `saveProductBatch` in
 * utils/scrapePersistence.js drops tombstoned ids itself, so no caller can write
 * one whether or not it remembered a skip-set. This script cleans up what got
 * through before that guard existed.
 *
 * It is safe to run repeatedly; on a healthy catalogue it finds nothing.
 *
 * Note: these products are removed, not re-tombstoned — the tombstone is already
 * there, which is exactly why they are being removed. No price is ever written.
 */
import dotenv from "dotenv"
dotenv.config()

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import mongoose from "mongoose"
import { Product } from "../models/Product.js"
import { DeletedProduct } from "../models/DeletedProduct.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const apply = process.argv.slice(2).includes("--apply")

await mongoose.connect(process.env.MONGO_URI)
console.log(`\n${apply ? "APPLY" : "DRY RUN"} — enforce admin deletions`)
console.log(`MongoDB connected: ${mongoose.connection.host}\n`)

const tombstones = await DeletedProduct.find({}, { id: 1, name: 1, deletedAt: 1 }).lean()
const total = await Product.countDocuments()
console.log(`${total} products in store, ${tombstones.length} tombstones on record`)

if (!tombstones.length) {
    console.log("no tombstones — nothing to enforce.")
    await mongoose.disconnect()
    process.exit(0)
}

const resurrected = await Product.find({ id: { $in: tombstones.map((t) => t.id) } }).lean()

console.log(`\nadmin-deleted products currently BACK in the catalogue: ${resurrected.length}`)
if (!resurrected.length) {
    console.log("✅ every admin deletion is being respected.")
    await mongoose.disconnect()
    process.exit(0)
}

for (const p of resurrected) {
    const t = tombstones.find((x) => x.id === p.id)
    console.log(`\n  ${p.id}`)
    console.log(`    ${(p.name || "").slice(0, 66)}`)
    console.log(`    €${p.price}   approved=${p.approved}`)
    console.log(`    deleted by admin : ${t?.deletedAt ? new Date(t.deletedAt).toISOString() : "unknown"}`)
    console.log(`    re-inserted at   : ${p.createdAt}`)
}

if (!apply) {
    console.log(`\nDRY RUN — nothing changed. Re-run with --apply to remove these ${resurrected.length} again.`)
    await mongoose.disconnect()
    process.exit(0)
}

// Back up before removing, same as every other destructive script here.
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const backupPath = path.join(__dirname, "..", `re-deleted-tombstoned-${stamp}.json`)
fs.writeFileSync(backupPath, JSON.stringify(resurrected, null, 2))
console.log(`\nbacked up ${resurrected.length} documents to ${path.basename(backupPath)}`)

const res = await Product.deleteMany({ id: { $in: resurrected.map((p) => p.id) } })
console.log(`✅ removed ${res.deletedCount} product(s) the admin had already deleted`)
console.log(`   products in store: ${total} -> ${await Product.countDocuments()}`)
console.log(`   prices changed: 0`)

await mongoose.disconnect()
process.exit(0)
