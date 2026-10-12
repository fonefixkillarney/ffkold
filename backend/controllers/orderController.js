import { Order } from "../models/Order.js"
import { Product } from "../models/Product.js"
import { User } from "../models/User.js"
import { sendNewOrderEmail, sendOrderStatusEmail } from "../utils/mailer.js"
import { computeOrderPricing } from "../utils/pricing.js"
import { FIRST_ORDER_DISCOUNT_PERCENT, resolveUserPromo } from "../utils/promo.js"
import { getStripe, isStripeConfigured } from "../utils/stripe.js"

function generateOrderNumber() {
    const rand = Math.random().toString(36).slice(2, 7).toUpperCase()
    return `ORD-${Date.now()}-${rand}`
}

// items[].sourceUrl is the supplier (mobigo.ie) page the admin buys from — it is
// where we source stock, so it must never reach a customer. Every public order
// response goes through this.
function withoutSupplierLinks(order) {
    const plain = typeof order?.toObject === "function" ? order.toObject() : order
    if (!plain?.items) return plain
    return {
        ...plain,
        items: plain.items.map(({ sourceUrl, ...item }) => item),
    }
}

// Orders placed before items carried a sourceUrl (and any whose product had no
// URL at the time) get one resolved from the catalog now, so the admin's "open
// on the supplier site" link works on the whole order history, not just new ones.
async function withSupplierLinks(orders) {
    const missing = [
        ...new Set(
            orders.flatMap((o) => (o.items || []).filter((i) => !i.sourceUrl).map((i) => i.productId)).filter(Boolean),
        ),
    ]
    if (missing.length === 0) return orders

    const products = await Product.find({ id: { $in: missing } }, { id: 1, url: 1 }).lean()
    const urlById = new Map(products.map((p) => [p.id, p.url || ""]))

    return orders.map((o) => ({
        ...o,
        items: (o.items || []).map((i) => (i.sourceUrl ? i : { ...i, sourceUrl: urlById.get(i.productId) || "" })),
    }))
}

// ─── First-order promo ─────────────────────────────────────────────────────
// Codes are now UNIQUE PER ACCOUNT (minted at signup, stored on the User) — no
// single shared code. Eligibility: the code must belong to the account whose
// email is being used, be unused, and it must be that account's first order.

// GET /api/orders/promo — public. Feeds the storefront balloon. There is no
// shared code to hand out anymore, so this only advertises the offer; the actual
// code is shown to each user right after they register.
export const getPromo = (req, res) => {
    res.status(200).json({
        success: true,
        data: {
            percent: FIRST_ORDER_DISCOUNT_PERCENT,
            description: `${FIRST_ORDER_DISCOUNT_PERCENT}% off your first order`,
            perAccount: true,
        },
    })
}

// POST /api/orders/promo/validate — public. { code, email } → 200 if the code
// belongs to that account, is unused, and no prior order exists; else 400.
export const validatePromo = async (req, res) => {
    try {
        const { code, email } = req.body
        const check = await resolveUserPromo(code, email)
        if (!check.valid) {
            return res.status(400).json({ success: false, message: check.message })
        }
        res.status(200).json({
            success: true,
            data: { code: check.code, percent: check.percent },
        })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// POST /api/orders — placed from checkout. Pricing (item prices, promo discount,
// delivery, total) is recomputed server-side; when Stripe is configured a
// succeeded PaymentIntent matching the total is required before the order is saved.
export const createOrder = async (req, res) => {
    try {
        const { customer, items, promoCode, paymentIntentId } = req.body

        if (!customer?.name || !customer?.email) {
            return res.status(400).json({ success: false, message: "customer name and email are required" })
        }

        // Authoritative recompute — the client can't set its own prices/discount
        // or delivery fee, and an under-minimum cart is rejected here.
        const pricing = await computeOrderPricing({
            items,
            promoCode,
            email: customer.email,
        })
        if (!pricing.valid) {
            return res.status(400).json({ success: false, message: pricing.message })
        }

        // Payment verification (only once Stripe keys are in .env).
        if (isStripeConfigured()) {
            if (!paymentIntentId) {
                return res.status(400).json({ success: false, message: "Payment is required to place this order" })
            }
            const stripe = getStripe()
            let intent
            try {
                intent = await stripe.paymentIntents.retrieve(paymentIntentId)
            } catch {
                return res.status(400).json({ success: false, message: "Could not verify payment" })
            }
            if (intent.status !== "succeeded") {
                return res.status(400).json({ success: false, message: `Payment not completed (status: ${intent.status})` })
            }
            if (intent.amount_received !== pricing.amountInCents || intent.currency !== pricing.currency) {
                return res.status(400).json({ success: false, message: "Payment amount does not match order total" })
            }
            const dup = await Order.exists({ paymentIntentId })
            if (dup) {
                return res.status(409).json({ success: false, message: "This payment has already been used for an order" })
            }
        }

        const order = await Order.create({
            orderNumber: generateOrderNumber(),
            customer,
            items: pricing.lineItems,
            subtotal: pricing.subtotal,
            shipping: pricing.shipping,
            tax: pricing.tax,
            promoCode: pricing.promoCode,
            discount: pricing.discount,
            total: pricing.total,
            paymentIntentId: paymentIntentId || undefined,
            paymentStatus: isStripeConfigured() ? "paid" : "demo",
        })

        // Burn the per-account promo so it can't be reused on a later order.
        if (pricing.promoUser && pricing.promoCode) {
            await User.updateOne({ _id: pricing.promoUser._id }, { $set: { promoUsed: true } })
        }

        res.status(201).json({ success: true, data: withoutSupplierLinks(order) })

        // Notify the store owner. Deliberately fired AFTER the response and
        // never awaited into the request path: the order is already saved (and
        // possibly already paid), so a mail outage or Resend latency must not
        // fail it or hold up the customer's confirmation.
        sendNewOrderEmail(order).catch((err) =>
            console.error(`[orders] New-order email failed for ${order.orderNumber}:`, err.message),
        )
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// GET /api/orders — admin-only, newest first
export const getOrders = async (req, res) => {
    try {
        const orders = await withSupplierLinks(await Order.find().sort({ createdAt: -1 }).lean())
        res.status(200).json({ success: true, count: orders.length, data: orders })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// DELETE /api/orders/:id — admin-only
export const deleteOrder = async (req, res) => {
    try {
        const order = await Order.findByIdAndDelete(req.params.id)
        if (!order) return res.status(404).json({ success: false, message: "Order not found" })
        res.status(200).json({ success: true, data: order })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// What the dashboard can SET. The schema also still accepts the legacy
// "Viewed"/"Rejected" so pre-existing orders stay valid, but they are not
// offered here — the four below are the whole lifecycle now.
const VALID_STATUSES = ["Pending", "Dispatched", "Completed", "Cancelled"]

// PATCH /api/orders/:id/status — admin-only. Sets Pending/Dispatched/Completed/
// Cancelled and emails the customer about the change.
export const updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body
        if (!VALID_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, message: `status must be one of: ${VALID_STATUSES.join(", ")}` })
        }

        const order = await Order.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true }).lean()
        if (!order) return res.status(404).json({ success: false, message: "Order not found" })

        const emailed = await notifyCustomer(order)

        // Same supplier-link resolution as the list, so the admin's open order
        // modal keeps its links after a status change re-renders it.
        const [withLinks] = await withSupplierLinks([order])
        res.status(200).json({ success: true, data: withLinks, emailed })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// Tell the customer their order moved. Awaited — unlike the new-order email,
// which sits on a shopper's checkout path — so the dashboard can report whether
// the customer was actually notified. It can never fail the caller: the status
// change is already committed either way, and mail is unconfigured in dev
// (a false return simply says so).
async function notifyCustomer(order) {
    try {
        // The customer's own "Send order status updates" setting (/user/settings).
        // Guest checkouts have no account behind the address, so they are always
        // notified. Reported as not-emailed, which is what the dashboard says.
        const email = order.customer?.email?.toLowerCase().trim()
        if (email && (await User.exists({ email, orderUpdates: false }))) {
            console.log(`[orders] Status email skipped for ${order.orderNumber} — customer opted out`)
            return false
        }

        const result = await sendOrderStatusEmail(order)
        if (!result?.sent) {
            console.warn(`[orders] Status email not sent for ${order.orderNumber} (${result?.reason})`)
            return false
        }
        return true
    } catch (err) {
        console.error(`[orders] Status email failed for ${order.orderNumber}:`, err.message)
        return false
    }
}

// PATCH /api/orders/:id/tracking — admin-only. The dispatch step: the admin
// types in the courier's tracking number and the order moves to Dispatched in
// the same write, so an order can never sit in the Dispatched tab with no way
// for the customer to follow it. The id belongs to an EXTERNAL carrier — this
// site never resolves it, it is only stored and quoted back in the email.
export const dispatchOrder = async (req, res) => {
    try {
        const trackingId = String(req.body?.trackingId ?? "").trim()
        if (!trackingId) {
            return res.status(400).json({ success: false, message: "trackingId is required" })
        }
        if (trackingId.length > 120) {
            return res.status(400).json({ success: false, message: "trackingId is too long" })
        }

        const order = await Order.findByIdAndUpdate(
            req.params.id,
            { $set: { trackingId, status: "Dispatched" } },
            { new: true },
        ).lean()
        if (!order) return res.status(404).json({ success: false, message: "Order not found" })

        // Same "never fails the request" contract as a plain status change — the
        // dispatch is committed whether or not Resend is configured.
        const emailed = await notifyCustomer(order)

        const [withLinks] = await withSupplierLinks([order])
        res.status(200).json({ success: true, data: withLinks, emailed })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// GET /api/orders/lookup/:orderNumber — public. orderNumber is an unguessable
// random token (not a sequential id), so this is a safe "track my order"
// lookup without requiring customer login.
export const getOrderByNumber = async (req, res) => {
    try {
        const order = await Order.findOne({ orderNumber: req.params.orderNumber }).lean()
        if (!order) return res.status(404).json({ success: false, message: "Order not found" })
        res.status(200).json({ success: true, data: withoutSupplierLinks(order) })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}
