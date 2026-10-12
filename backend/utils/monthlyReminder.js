// Monthly "new products are landing" reminder to every customer who has ordered.
//
// When: the 1st of each month from 10:00 Irish time (a server that was down then
// catches up until the 7th). The check runs hourly; the MailCampaign unique key
// makes each month send at most once however many times the check fires.
//
// The month this feature is first deployed is recorded as skipped rather than
// sent, so the first email goes out on the following 1st — deploying mid-month
// never fires a surprise blast at the whole customer list.
//
// Recipients: distinct customer emails across orders that were not Cancelled or
// Rejected, minus anyone who unsubscribed (MarketingOptOut).
//
// MONTHLY_REMINDER=off disables it. API_PUBLIC_URL sets the base of the
// unsubscribe link (falls back to Railway's RAILWAY_PUBLIC_DOMAIN).
import crypto from "crypto"
import { MailCampaign } from "../models/MailCampaign.js"
import { MarketingOptOut } from "../models/MarketingOptOut.js"
import { Order } from "../models/Order.js"
import { sendMonthlyReminderEmails } from "./mailer.js"

const KEY_PREFIX = "monthly-reminder:"
const SEND_HOUR = 10
const CATCH_UP_DAYS = 7
const CHECK_EVERY_MS = 60 * 60 * 1000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const secret = () => process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || ""

export function unsubscribeToken(email) {
    return crypto.createHmac("sha256", secret()).update(`unsubscribe:${email}`).digest("hex").slice(0, 32)
}

function tokenMatches(email, token) {
    const expected = Buffer.from(unsubscribeToken(email))
    const given = Buffer.from(String(token || ""))
    return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

function apiBase() {
    if (process.env.API_PUBLIC_URL) return process.env.API_PUBLIC_URL.replace(/\/$/, "")
    if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    return `http://localhost:${process.env.PORT || 5000}`
}

export function unsubscribeUrlFor(email) {
    const q = new URLSearchParams({ email, token: unsubscribeToken(email) })
    return `${apiBase()}/api/user/unsubscribe?${q}`
}

// Calendar position in Ireland, whatever timezone the server runs in.
function dublinNow() {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", {
            timeZone: "Europe/Dublin",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            hourCycle: "h23",
        })
            .formatToParts(new Date())
            .map((p) => [p.type, p.value])
    )
    return { monthKey: `${parts.year}-${parts.month}`, day: Number(parts.day), hour: Number(parts.hour) }
}

export async function reminderRecipients() {
    const [rows, optOuts] = await Promise.all([
        Order.aggregate([
            { $match: { status: { $nin: ["Cancelled", "Rejected"] }, "customer.email": { $nin: [null, ""] } } },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: { $toLower: { $trim: { input: "$customer.email" } } },
                    name: { $first: "$customer.name" },
                },
            },
        ]),
        MarketingOptOut.find({}, { email: 1 }).lean(),
    ])
    const out = new Set(optOuts.map((o) => o.email))
    return rows
        .filter((r) => EMAIL_RE.test(r._id) && !out.has(r._id))
        .map((r) => ({ email: r._id, name: (r.name || "").trim(), unsubscribeUrl: unsubscribeUrlFor(r._id) }))
}

const isDuplicateKey = (err) => err?.code === 11000

// Sends this month's reminder if it is due and nobody has sent it yet.
async function checkAndSend() {
    const { monthKey, day, hour } = dublinNow()
    const key = `${KEY_PREFIX}${monthKey}`

    // First run ever: mark this month done so the first email is next month's.
    if (!(await MailCampaign.exists({ key: { $regex: `^${KEY_PREFIX}` } }))) {
        try {
            await MailCampaign.create({ key, status: "skipped", note: "feature introduced this month", finishedAt: new Date() })
            console.log(`[monthly-reminder] enabled — first send on the 1st of next month (this month, ${monthKey}, skipped)`)
        } catch (err) {
            if (!isDuplicateKey(err)) throw err
        }
        return
    }

    const due = (day === 1 && hour >= SEND_HOUR) || (day > 1 && day <= CATCH_UP_DAYS)
    if (!due) return

    // The insert IS the lock — a duplicate key means this month is already taken.
    let campaign
    try {
        campaign = await MailCampaign.create({ key, status: "sending" })
    } catch (err) {
        if (isDuplicateKey(err)) return
        throw err
    }

    const recipients = await reminderRecipients()
    console.log(`[monthly-reminder] ${monthKey}: sending to ${recipients.length} customer(s)`)
    const { sent, failed } = recipients.length
        ? await sendMonthlyReminderEmails(recipients, { idempotencyKey: key })
        : { sent: 0, failed: 0 }
    await MailCampaign.updateOne(
        { _id: campaign._id },
        { $set: { status: "sent", recipients: recipients.length, sent, failed, finishedAt: new Date() } }
    )
}

let timer = null
export function scheduleMonthlyReminder() {
    if (String(process.env.MONTHLY_REMINDER || "").toLowerCase() === "off") {
        console.log("[monthly-reminder] disabled (MONTHLY_REMINDER=off)")
        return
    }
    if (timer) return
    const tick = () =>
        checkAndSend().catch((err) => console.error(`[monthly-reminder] check failed: ${err.message}`))
    // A minute after boot (DB connected, server listening), then hourly.
    setTimeout(tick, 60 * 1000).unref?.()
    timer = setInterval(tick, CHECK_EVERY_MS)
    timer.unref?.()
}

// GET from the email link, POST from a mail client's one-click unsubscribe.
export async function unsubscribe(req, res) {
    const email = String(req.query.email || req.body?.email || "").toLowerCase().trim()
    const token = req.query.token || req.body?.token
    if (!EMAIL_RE.test(email) || !tokenMatches(email, token)) {
        return res.status(400).send("This unsubscribe link is invalid or incomplete.")
    }
    await MarketingOptOut.updateOne({ email }, { $setOnInsert: { email } }, { upsert: true })
    if (req.method === "POST") return res.status(200).send("Unsubscribed")
    const store = (process.env.CLIENT_URL || "/").replace(/\/$/, "")
    res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f4f4f5;margin:0;padding:48px 16px;text-align:center;color:#111">
<div style="max-width:420px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
<h1 style="font-size:20px;margin:0 0 8px">You're unsubscribed</h1>
<p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 20px">You won't receive our monthly product emails any more. Order updates are not affected.</p>
<a href="${store}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:6px">Back to the shop</a>
</div></body></html>`)
}
