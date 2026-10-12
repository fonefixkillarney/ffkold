/**
 * Bulk-approve (or un-approve) scraped products — run from terminal:
 *
 *   node utils/approveProducts.js                        # dry run: what would change
 *   node utils/approveProducts.js --apply                # publish every pending product
 *   node utils/approveProducts.js --path=mobile-cases-by-brand/apple --apply
 *   node utils/approveProducts.js --revert --apply       # pull them back off the storefront
 *
 * Why this exists: newly scraped products are inserted unapproved and stay
 * invisible to shoppers until the admin approves them, which the panel at
 * /admin/upcoming-products does one product at a time. That is the right workflow for a
 * handful of new arrivals and an impossible one after a re-ingest that adds
 * thousands, so this does the same thing in bulk.
 *
 * It is deliberately dry-run by default — approving publishes products to a live
 * storefront. `--revert` is the exact inverse, so neither direction is one-way.
 *
 * Nothing else is touched: no prices, no categories, no deletions. Products the
 * blocklist hides stay hidden regardless, because the read APIs filter them out
 * on every request.
 */
import dotenv from "dotenv"
dotenv.config()

import mongoose from "mongoose"
import { Product } from "../models/Product.js"
import { isBlockedProduct } from "./blocklist.js"

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const revert = args.includes("--revert")
const pathArg = args.find((a) => a.startsWith("--path="))?.slice("--path=".length) ?? ""
const limitArg = Number(args.find((a) => a.startsWith("--limit="))?.slice("--limit=".length) ?? 0)

await mongoose.connect(process.env.MONGO_URI)

const target = revert ? true : { $ne: true }
const filter = { approved: target }
if (pathArg) {
    const escaped = pathArg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    filter["categoryTags.path"] = { $regex: `^${escaped}(/|$)` }
}

const [total, approvedNow, pendingNow] = await Promise.all([
    Product.countDocuments(),
    Product.countDocuments({ approved: true }),
    Product.countDocuments({ approved: { $ne: true } }),
])
console.log(`store: ${total} products — ${approvedNow} approved, ${pendingNow} pending\n`)

const matches = await Product.find(filter, { id: 1, name: 1, price: 1, categoryTags: 1 }).lean()
// Blocklisted products are filtered out of every read anyway, so approving them
// would be a no-op that inflates the count and misreports what changed.
const actionable = matches.filter((p) => !isBlockedProduct(p))
const blocked = matches.length - actionable.length

const verb = revert ? "un-approve" : "approve"
console.log(`${actionable.length} products to ${verb}${pathArg ? ` under "${pathArg}"` : ""}${blocked ? ` (${blocked} blocklisted, skipped)` : ""}`)
if (!actionable.length) {
    console.log("nothing to do.")
    await mongoose.disconnect()
    process.exit(0)
}

console.log(`\nsample:`)
for (const p of actionable.slice(0, 10)) {
    console.log(`  €${String(p.price ?? 0).padEnd(7)} ${p.name?.slice(0, 62) ?? ""}`)
}
if (actionable.length > 10) console.log(`  … and ${actionable.length - 10} more`)

if (!apply) {
    console.log(`\nDRY RUN — nothing was changed. Re-run with --apply to ${verb} these ${actionable.length} products.`)
    await mongoose.disconnect()
    process.exit(0)
}

const ids = (limitArg > 0 ? actionable.slice(0, limitArg) : actionable).map((p) => p.id)
const res = await Product.updateMany({ id: { $in: ids } }, { $set: { approved: !revert } })
console.log(`\n✅ ${verb}d ${res.modifiedCount} products`)
const after = await Product.countDocuments({ approved: true })
console.log(`   approved (visible on the storefront): ${approvedNow} -> ${after}`)

await mongoose.disconnect()
process.exit(0)
