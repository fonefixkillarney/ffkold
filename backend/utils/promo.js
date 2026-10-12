import { User } from "../models/User.js"
import { Order } from "../models/Order.js"

// Every registered account gets its OWN unique first-order code (generated at
// signup, stored on the User). There is no single shared code anymore — a code
// is valid only for the account it belongs to, only once, and only on that
// account's first order.
export const FIRST_ORDER_DISCOUNT_PERCENT = 10

// Unambiguous charset (no 0/O/1/I) so a code is easy to read off a screen.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function randomCode(len = 6) {
    let out = ""
    for (let i = 0; i < len; i++) {
        out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    }
    return out
}

// Generates a code guaranteed not to collide with an existing account's code.
export async function generateUniquePromoCode() {
    for (let attempt = 0; attempt < 10; attempt++) {
        const code = `WELCOME-${randomCode(6)}`
        const taken = await User.exists({ promoCode: code })
        if (!taken) return code
    }
    // Astronomically unlikely fallback: widen the random part.
    return `WELCOME-${randomCode(10)}`
}

// Read-only eligibility check for a per-account first-order code. Used by the
// checkout "Apply" button, the payment-intent amount calc, and the final order
// create (which re-checks before trusting any discount).
export async function resolveUserPromo(code, email) {
    const cleanCode = String(code ?? "").trim().toUpperCase()
    if (!cleanCode) {
        return { valid: false, message: "Enter your promo code" }
    }

    const user = await User.findOne({ promoCode: cleanCode })
    if (!user) {
        return { valid: false, message: "Invalid promo code" }
    }

    const cleanEmail = String(email ?? "").trim().toLowerCase()
    if (cleanEmail && user.email !== cleanEmail) {
        return {
            valid: false,
            message: "This code belongs to a different account — use the email you signed up with",
        }
    }

    if (user.promoUsed) {
        return { valid: false, message: "This code has already been used" }
    }

    // First order only: reject if this account's email has any prior order.
    const priorOrder = await Order.exists({
        "customer.email": { $regex: `^${escapeRegex(user.email)}$`, $options: "i" },
    })
    if (priorOrder) {
        return { valid: false, message: "This code is valid on your first order only" }
    }

    return { valid: true, percent: FIRST_ORDER_DISCOUNT_PERCENT, code: cleanCode, user }
}
