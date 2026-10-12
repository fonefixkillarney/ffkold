import Stripe from "stripe"

// The Stripe secret key is provided later (like any live credential). Until it's
// set in .env the app still runs — payment endpoints report "not configured" and
// the checkout falls back to a demo order instead of crashing.
let stripeClient = null

export function isStripeConfigured() {
    return Boolean(process.env.STRIPE_SECRET_KEY)
}

export function getStripe() {
    if (!isStripeConfigured()) return null
    if (!stripeClient) {
        stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY)
    }
    return stripeClient
}
