import mongoose from "mongoose"

const orderItemSchema = new mongoose.Schema(
    {
        productId: String,
        name: String,
        image: String,
        price: Number,
        quantity: Number,
        sourceUrl: String,
    },
    { _id: false }
)

const orderSchema = new mongoose.Schema({
    orderNumber: { type: String, required: true, unique: true },
    customer: {
        name: { type: String, required: true },
        email: { type: String, required: true },
        phone: String,
        address: String,
        city: String,
        postalCode: String,
    },
    items: [orderItemSchema],
    subtotal: { type: Number, required: true },
    shipping: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    promoCode: { type: String, default: "" },
    discount: { type: Number, default: 0 },
    total: { type: Number, required: true },

    paymentIntentId: { type: String, unique: true, sparse: true },
    paymentStatus: { type: String, enum: ["paid", "demo"], default: "demo" },

    status: {
        type: String,
        enum: ["Pending", "Dispatched", "Completed", "Cancelled", "Viewed", "Rejected"],
        default: "Pending",
    },

    trackingId: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
})

export const Order = mongoose.model("Order", orderSchema)
