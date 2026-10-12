import mongoose from "mongoose"

const bannerSchema = new mongoose.Schema({
    image: { type: String, required: true },
    link: { type: String, default: "" },
    alt: { type: String, default: "" },
    order: { type: Number, default: 0 },
    // Same gate as products: a freshly scraped banner stays off the hero slider
    // until the admin approves it at /admin/upcoming-products.
    approved: { type: Boolean, default: false },
})

export const Banner = mongoose.model("Banner", bannerSchema)
