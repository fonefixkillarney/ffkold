import { Product } from "../models/Product.js"
import { resolveUserPromo } from "./promo.js"

// ── Money rules (single source of truth, mirrored on the checkout UI) ──────────
//   • Orders below €10 of goods are rejected outright — no checkout.
//   • €10 up to €25 (post-discount) → flat €5 delivery.
//   • €25 and above                 → delivery is free.
// Delivery is derived here, never chosen by the client, so a tampered request
// can't zero it out. Tax is folded into that flat delivery fee and stays 0 (the
// field is kept on the order so historical orders still add up).
export const MIN_ORDER_TOTAL = 10 // euros — minimum goods subtotal to check out
export const FREE_DELIVERY_THRESHOLD = 25 // euros — at/above this, delivery is free
export const DELIVERY_FEE = 5 // euros, flat, below the threshold
export const CURRENCY = "eur"

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export function computeDelivery(taxableSubtotal, hasItems) {
    if (!hasItems) return 0
    return taxableSubtotal < FREE_DELIVERY_THRESHOLD ? DELIVERY_FEE : 0
}

// Server-authoritative pricing for an order. Product prices are read from the
// DB (never trusted from the client), the promo is re-validated per-account, and
// delivery/total are recomputed here so both the Stripe PaymentIntent amount and
// the persisted order use the exact same numbers.
//
// Returns { valid: false, message } on any rejection (bad items / bad promo /
// under the €10 minimum).
export async function computeOrderPricing({ items, promoCode, email }) {
    if (!Array.isArray(items) || items.length === 0) {
        return { valid: false, message: "order must include at least one item" }
    }

    const ids = items.map((i) => i.productId).filter(Boolean)
    const dbProducts = await Product.find({ id: { $in: ids } }, { id: 1, price: 1, name: 1, images: 1, url: 1 }).lean()
    const byId = new Map(dbProducts.map((p) => [p.id, p]))

    const lineItems = []
    let subtotal = 0
    for (const item of items) {
        const qty = Math.max(1, Math.floor(Number(item.quantity) || 1))
        const dbp = byId.get(item.productId)
        // DB price wins; the client price is only a fallback for a product that
        // somehow isn't in the DB.
        const unit = dbp ? Number(dbp.price) || 0 : Number(item.price) || 0
        subtotal += unit * qty
        lineItems.push({
            productId: item.productId,
            name: dbp?.name || item.name,
            image: dbp?.images?.[0] || item.image || "",
            price: unit,
            quantity: qty,
            // Admin-only supplier link (see models/Order.js). Taken from the DB
            // product, never from the client.
            sourceUrl: dbp?.url || "",
        })
    }
    subtotal = round2(subtotal)

    // Minimum-order gate. Measured on the goods subtotal BEFORE any discount, so
    // a promo code can never drag an otherwise-valid order under the minimum.
    if (subtotal < MIN_ORDER_TOTAL) {
        return {
            valid: false,
            message: `Minimum order is €${MIN_ORDER_TOTAL.toFixed(2)} — your items come to €${subtotal.toFixed(2)}`,
        }
    }

    let discount = 0
    let appliedPromo = ""
    let promoUser = null
    if (String(promoCode ?? "").trim() !== "") {
        const check = await resolveUserPromo(promoCode, email)
        if (!check.valid) {
            return { valid: false, message: check.message }
        }
        discount = round2((subtotal * check.percent) / 100)
        appliedPromo = check.code
        promoUser = check.user
    }

    const taxableSubtotal = round2(subtotal - discount)
    const shippingCost = computeDelivery(taxableSubtotal, lineItems.length > 0)
    const tax = 0 // folded into the flat delivery fee; kept for order-schema compat
    const total = round2(taxableSubtotal + shippingCost + tax)

    return {
        valid: true,
        lineItems,
        subtotal,
        discount,
        tax,
        shipping: shippingCost,
        total,
        promoCode: appliedPromo,
        promoUser,
        amountInCents: Math.round(total * 100),
        currency: CURRENCY,
    }
}
