import mongoose from "mongoose"

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    // Google's stable account id ("sub"), set on "Sign in with Google".
    googleId: { type: String, default: null },
    promoCode: { type: String, unique: true, sparse: true },
    promoUsed: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    verificationCodeHash: { type: String, default: null },
    verificationExpires: { type: Date, default: null },
    verificationAttempts: { type: Number, default: 0 },
    verificationSentAt: { type: Date, default: null },

    resetCodeHash: { type: String, default: null },
    resetExpires: { type: Date, default: null },
    resetAttempts: { type: Number, default: 0 },
    resetSentAt: { type: Date, default: null },

    pendingEmail: { type: String, default: null, lowercase: true, trim: true },
    emailChangeCodeHash: { type: String, default: null },
    emailChangeExpires: { type: Date, default: null },
    emailChangeAttempts: { type: Number, default: 0 },
    emailChangeSentAt: { type: Date, default: null },

    orderUpdates: { type: Boolean, default: true },
    saleAlerts: { type: Boolean, default: false },

    createdAt: { type: Date, default: Date.now },
})

export const User = mongoose.model("User", userSchema)
