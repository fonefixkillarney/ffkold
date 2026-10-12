import { Banner } from "../models/Banner.js"
import { Product } from "../models/Product.js"

// One-time migration for the approval gate. Everything already in the DB when
// the gate was introduced predates it and is treated as approved — without this
// the storefront would go completely blank on the deploy that added the field.
//
// Matching on `$exists: false` is what makes this safe to run on every boot:
// once a document has an `approved` field (true OR false) it is never touched
// again, so a product the admin has deliberately left unapproved is not
// silently published by the next restart.
export async function backfillApproval() {
    const [products, banners] = await Promise.all([
        Product.updateMany({ approved: { $exists: false } }, { $set: { approved: true } }),
        Banner.updateMany({ approved: { $exists: false } }, { $set: { approved: true } }),
    ])

    if (products.modifiedCount || banners.modifiedCount) {
        console.log(
            `[backfillApproval] Marked pre-existing content approved: ${products.modifiedCount} products, ${banners.modifiedCount} banners`
        )
    }
}
