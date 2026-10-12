// One-shot script: fix thumbnail image URLs in MongoDB products
// Run once: node utils/fixImages.js
import mongoose from "mongoose"
import dotenv from "dotenv"
dotenv.config()

import { Product } from "../models/Product.js"

const fixImgUrl = (url) => {
    if (!url) return url
    let u = url.trim()
    // Remove thumbnail T suffix: -1T.jpg → -1.jpg
    u = u.replace(/(-\d+)T(\.(jpe?g|png|gif|webp))/i, "$1$2")
    // Strip query params (v-cache, etc.)
    u = u.split("?")[0]
    return u
}

async function run() {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("Connected to MongoDB")

    const products = await Product.find({}).lean()
    console.log(`Checking ${products.length} products…`)

    let updated = 0
    for (const p of products) {
        const fixed = (p.images || []).map(fixImgUrl)
        const changed = fixed.some((img, i) => img !== (p.images || [])[i])
        if (changed) {
            await Product.updateOne({ _id: p._id }, { $set: { images: fixed } })
            updated++
        }
    }

    console.log(`✅ Updated ${updated} products`)
    await mongoose.disconnect()
}

run().catch((err) => { console.error(err); process.exit(1) })
