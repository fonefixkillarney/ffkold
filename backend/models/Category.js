import mongoose from "mongoose"

const nodeSchema = new mongoose.Schema(
    {
        label: String,
        slug: String,
        url: String,
        items: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },
    { _id: false }
)

const categorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    url: String,
    group: { type: String, default: "" },
    order: { type: Number, default: 0 },
    items: [nodeSchema],
})

export const Category = mongoose.model("Category", categorySchema)
