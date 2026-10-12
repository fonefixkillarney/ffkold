import mongoose from "mongoose"

// Addresses that clicked "Unsubscribe" in a marketing email. Checked before every
// monthly reminder; order and account emails are unaffected.
const marketingOptOutSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    createdAt: { type: Date, default: Date.now },
})

export const MarketingOptOut = mongoose.model("MarketingOptOut", marketingOptOutSchema)
