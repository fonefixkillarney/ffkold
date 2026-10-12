import { computeOrderPricing } from "../utils/pricing.js"
import { getStripe, isStripeConfigured } from "../utils/stripe.js"

// GET /api/payment/config — public. Lets the frontend load Stripe.js with the
// publishable key without needing its own env var, and know whether payment is
// live yet.
export const getPaymentConfig = (req, res) => {
    res.status(200).json({
        success: true,
        data: {
            configured: isStripeConfigured(),
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
            currency: "eur",
        },
    })
}

// POST /api/payment/create-intent — public (guest checkout). Recomputes the
// order total server-side from DB prices + the per-account promo + the delivery
// rule, then creates a Stripe PaymentIntent for exactly that amount and returns
// its client secret plus the authoritative price breakdown for the UI to display.
// Carts under the €10 minimum are rejected here, before any intent is created.
export const createPaymentIntent = async (req, res) => {
    try {
        const { items, promoCode, email, customer } = req.body

        const pricing = await computeOrderPricing({ items, promoCode, email })
        if (!pricing.valid) {
            return res.status(400).json({ success: false, message: pricing.message })
        }

        if (!isStripeConfigured()) {
            // Payment keys not added yet: hand the breakdown back so checkout can
            // still show correct totals and offer the demo-order fallback.
            return res.status(200).json({
                success: true,
                data: { configured: false, clientSecret: null, pricing: publicPricing(pricing) },
            })
        }

        const stripe = getStripe()
        const intent = await stripe.paymentIntents.create({
            amount: pricing.amountInCents,
            currency: pricing.currency,
            // allow_redirects:"never" drops redirect-only methods, but Revolut
            // Pay and Satispay still pass it (they can finish via QR code on
            // desktop) and redirect on phones — so the client always confirms
            // with a return_url pointing at /checkout/complete.
            automatic_payment_methods: { enabled: true, allow_redirects: "never" },
            receipt_email: customer?.email || email || undefined,
            metadata: {
                email: (customer?.email || email || "").toString().slice(0, 200),
                promoCode: pricing.promoCode || "",
            },
        })

        res.status(200).json({
            success: true,
            data: {
                configured: true,
                clientSecret: intent.client_secret,
                paymentIntentId: intent.id,
                pricing: publicPricing(pricing),
            },
        })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// Only the display-safe numbers — never the resolved promo user document.
function publicPricing(p) {
    return {
        subtotal: p.subtotal,
        discount: p.discount,
        tax: p.tax,
        shipping: p.shipping,
        total: p.total,
        promoCode: p.promoCode,
        currency: p.currency,
    }
}
