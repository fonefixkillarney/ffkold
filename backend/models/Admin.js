import mongoose from "mongoose"

const adminSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },

    role: { type: String, enum: ["admin", "very-admin"], default: "admin" },
    createdAt: { type: Date, default: Date.now },
})

export const Admin = mongoose.model("Admin", adminSchema)
