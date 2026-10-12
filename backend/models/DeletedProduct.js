import mongoose from "mongoose"

// Tombstones for products the admin deleted. The Product document itself is
// removed, so this collection is the only record that the id ever existed — and
// it is what keeps the product deleted: every scrape seeds its skip-set with
// these ids, so the crawler never re-inserts one.
const deletedProductSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: String,
    deletedAt: { type: Date, default: Date.now },
})

export const DeletedProduct = mongoose.model("DeletedProduct", deletedProductSchema)
