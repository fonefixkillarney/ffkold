import mongoose from "mongoose"

// One document per scheduled send, keyed e.g. "monthly-reminder:2026-11". The
// unique key is the lock: whichever process inserts it first sends that month,
// so a restart or a second instance can never mail the customers twice.
const mailCampaignSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    status: { type: String, enum: ["sending", "sent", "skipped"], default: "sending" },
    recipients: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    note: { type: String, default: "" },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
})

export const MailCampaign = mongoose.model("MailCampaign", mailCampaignSchema)
