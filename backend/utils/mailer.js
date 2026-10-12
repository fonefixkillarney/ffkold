import { Resend } from "resend"

// Resend is initialised lazily from RESEND_API_KEY (provided later, like the
// Stripe keys). Until it's set, email is simply skipped — the scrape still runs.
let resendClient = null

function getResend() {
    if (!process.env.RESEND_API_KEY) return null
    if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY)
    return resendClient
}

export function isMailerConfigured() {
    return Boolean(process.env.RESEND_API_KEY)
}

// The business trades as FFK Tech (formerly Fonefix Killarney). Defined once
// here so the sender name and every email's header/footer stay in step.
const BRAND = "FFK Tech"
const BRAND_SHORT = "FFK"
const BRAND_LOCATION = "Killarney, Co. Kerry, Ireland"

// Cloudinary-hosted brand logo used in the header and footer of every email.
const LOGO_URL =
    "https://res.cloudinary.com/kqvaj1xz/image/upload/v1790710647/FoneFix-Logo.png"

// Sender selection, derived from the existing admin recipient keys — no new env
// vars needed. Admin-only mail (the scrape digest) goes out from the admin's own
// address (ADMIN_NOTIFY_EMAIL); everything else (orders, status updates,
// verification codes) goes out from the store's main address (ADMIN_EMAIL).
//
// RESEND_FROM_EMAIL, if set, overrides BOTH senders — handy once a verified
// domain lets you send from e.g. orders@ffktech.ie instead of a raw Gmail.
const FROM = () => process.env.RESEND_FROM_EMAIL

const FROM_ADMIN = () =>
    FROM() || `${BRAND} <${process.env.ADMIN_NOTIFY_EMAIL}>`
const FROM_STORE = () =>
    FROM() || `${BRAND} <${process.env.ADMIN_EMAIL}>`

const ADMIN_RECIPIENT = () => process.env.ADMIN_NOTIFY_EMAIL || process.env.ADMIN_EMAIL
const STORE_URL = () => (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/$/, "")

// Keep the email a sane size — the very first scrape of an empty DB can surface
// thousands of "new" products; later incremental runs surface only a handful.
const MAX_IN_EMAIL = 100

const escapeHtml = (s) =>
    String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")

// ── Shared FFK Tech chrome ──
// Every email below — admin notification or customer-facing — renders its body
// through this wrapper, so the brand header and footer are identical across all
// of them and only have to change in one place.
function wrapEmail(inner, { maxWidth = 640 } = {}) {
    const bareUrl = STORE_URL().replace(/^https?:\/\//, "")
    return `
  <div style="background:#f4f4f5;padding:24px 12px">
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:${maxWidth}px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <div style="background:#111;padding:22px 24px;text-align:center">
        <a href="${STORE_URL()}" target="_blank" rel="noreferrer" style="text-decoration:none">
          <img src="${LOGO_URL}" alt="${BRAND}" width="180"
               style="display:inline-block;max-width:180px;height:auto;background:#fff;padding:10px 16px;border-radius:8px" />
        </a>
      </div>
      <div style="padding:24px">${inner}</div>
      <div style="border-top:1px solid #eee;padding:18px 24px;text-align:center;color:#6b7280;font-size:12px;line-height:1.7">
        <a href="${STORE_URL()}" target="_blank" rel="noreferrer" style="text-decoration:none">
          <img src="${LOGO_URL}" alt="${BRAND}" width="120"
               style="display:inline-block;max-width:120px;height:auto;margin:0 auto 8px" />
        </a>
        <div>${BRAND_LOCATION}</div>
        <div><a href="${STORE_URL()}" target="_blank" rel="noreferrer" style="color:#6b7280">${escapeHtml(bareUrl)}</a></div>
        <div style="margin-top:8px">© ${new Date().getFullYear()} ${BRAND}. All rights reserved.</div>
      </div>
    </div>
  </div>`
}

function productRowHtml(p) {
    const storeUrl = `${STORE_URL()}/product/${encodeURIComponent(p.id)}`
    const name = escapeHtml(p.name || "Unnamed product")
    const price = Number.isFinite(Number(p.price)) ? `€${Number(p.price).toFixed(2)}` : ""
    const img = p.image
        ? `<img src="${escapeHtml(p.image)}" alt="" width="56" height="56" style="width:56px;height:56px;object-fit:contain;border-radius:6px;background:#fff;border:1px solid #eee" />`
        : ""
    // Two links per requirement: the primary one opens the product ON OUR STORE
    // (where the admin edits it); the secondary is the original scraped source.
    const sourceLink = p.url
        ? `<a href="${escapeHtml(p.url)}" style="color:#6b7280;font-size:12px" target="_blank" rel="noreferrer">View original source ↗</a>`
        : ""
    return `
    <tr>
      <td style="padding:12px 8px;border-bottom:1px solid #eee;vertical-align:top;width:64px">${img}</td>
      <td style="padding:12px 8px;border-bottom:1px solid #eee;vertical-align:top">
        <div style="font-weight:600;color:#111;font-size:14px">${name}</div>
        <div style="color:#6b7280;font-size:12px;margin:2px 0 8px">${price}</div>
        <a href="${storeUrl}" target="_blank" rel="noreferrer"
           style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:8px 14px;border-radius:6px">
          Review &amp; edit on your store →
        </a>
        <div style="margin-top:6px">${sourceLink}</div>
      </td>
    </tr>`
}

function buildHtml(products) {
    const shown = products.slice(0, MAX_IN_EMAIL)
    const extra = products.length - shown.length
    const rows = shown.map(productRowHtml).join("")
    const more =
        extra > 0
            ? `<p style="color:#6b7280;font-size:13px;margin-top:16px">…and ${extra} more new product${extra === 1 ? "" : "s"} added in this run.</p>`
            : ""
    return wrapEmail(`
    <h2 style="color:#111;margin:0 0 4px">${products.length} new product${products.length === 1 ? "" : "s"} added</h2>
    <p style="color:#6b7280;font-size:14px;margin:0 0 20px">
      Review each one on the ${BRAND} store and adjust its price if needed. The button opens the product page on your site;
      the link underneath opens the original source listing.
    </p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    ${more}`)
}

// ── New-order notification (to the store owner) ──
// Recipient is ADMIN_EMAIL (the store's main address). Unlike the customer
// verification codes, this only ever goes to that one
// fixed address, so Resend's shared test sender is enough for it as long as that
// address owns the Resend account.
const money = (n) => `€${(Number(n) || 0).toFixed(2)}`

function orderItemRowHtml(item) {
    const img = item.image
        ? `<img src="${escapeHtml(item.image)}" alt="" width="48" height="48" style="width:48px;height:48px;object-fit:contain;border-radius:6px;background:#fff;border:1px solid #eee" />`
        : ""
    return `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;width:56px">${img}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee">
        <div style="font-weight:600;color:#111;font-size:14px">${escapeHtml(item.name)}</div>
        <div style="color:#6b7280;font-size:12px">Qty ${item.quantity} × ${money(item.price)}</div>
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:#111;font-size:14px;white-space:nowrap">
        ${money(item.price * item.quantity)}
      </td>
    </tr>`
}

function totalsRowHtml(label, value, opts = {}) {
    const weight = opts.bold ? "700" : "400"
    const size = opts.bold ? "16px" : "13px"
    const color = opts.color || (opts.bold ? "#111" : "#6b7280")
    return `
    <tr>
      <td style="padding:4px 0;color:#6b7280;font-size:${size}">${escapeHtml(label)}</td>
      <td style="padding:4px 0;text-align:right;font-weight:${weight};font-size:${size};color:${color};white-space:nowrap">${value}</td>
    </tr>`
}

export async function sendNewOrderEmail(order) {
    if (!order) return { sent: false, reason: "no-order" }

    const resend = getResend()
    if (!resend) {
        console.warn(`[mailer] RESEND_API_KEY not set — skipping new-order email for ${order.orderNumber}`)
        return { sent: false, reason: "not-configured" }
    }

    const to = process.env.ADMIN_EMAIL
    if (!to) {
        console.warn("[mailer] No ADMIN_EMAIL recipient set — skipping new-order email")
        return { sent: false, reason: "no-recipient" }
    }

    const c = order.customer || {}
    const address = [c.address, c.city, c.postalCode].filter(Boolean).join(", ")
    const isDemo = order.paymentStatus === "demo"

    const html = wrapEmail(`
    <h2 style="color:#111;margin:0 0 4px">New order — ${money(order.total)}</h2>
    <p style="color:#6b7280;font-size:14px;margin:0 0 4px">
      Order <strong style="color:#111">${escapeHtml(order.orderNumber)}</strong>
    </p>
    ${isDemo
            ? `<p style="background:#fffbeb;border:1px solid #f59e0b;color:#78350f;font-size:13px;padding:10px 12px;border-radius:6px;margin:12px 0">
             <strong>Demo order — no payment was taken.</strong> Stripe keys aren't configured yet.
           </p>`
            : `<p style="background:#ecfdf5;border:1px solid #10b981;color:#065f46;font-size:13px;padding:10px 12px;border-radius:6px;margin:12px 0">
             <strong>Paid</strong> — verified against Stripe payment ${escapeHtml(order.paymentIntentId || "")}.
           </p>`
        }

    <h3 style="color:#111;font-size:15px;margin:20px 0 6px">Customer</h3>
    <p style="color:#374151;font-size:14px;margin:0;line-height:1.6">
      ${escapeHtml(c.name)}<br />
      <a href="mailto:${escapeHtml(c.email)}" style="color:#2563eb">${escapeHtml(c.email)}</a>
      ${c.phone ? `<br />${escapeHtml(c.phone)}` : ""}
      ${address ? `<br />${escapeHtml(address)}` : ""}
    </p>

    <h3 style="color:#111;font-size:15px;margin:20px 0 6px">Items</h3>
    <table style="width:100%;border-collapse:collapse">${(order.items || []).map(orderItemRowHtml).join("")}</table>

    <table style="width:100%;border-collapse:collapse;margin-top:16px">
      ${totalsRowHtml("Subtotal", money(order.subtotal))}
      ${order.discount > 0
            ? totalsRowHtml(
                `Discount${order.promoCode ? ` (${order.promoCode})` : ""}`,
                `− ${money(order.discount)}`,
                { color: "#059669" },
            )
            : ""
        }
      ${totalsRowHtml("Delivery", money(order.shipping))}
      ${order.tax > 0 ? totalsRowHtml("Tax", money(order.tax)) : ""}
      ${totalsRowHtml("Total", money(order.total), { bold: true })}
    </table>

    <div style="margin-top:24px">
      <a href="${STORE_URL()}/admin" target="_blank" rel="noreferrer"
         style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 16px;border-radius:6px">
        Open the orders dashboard →
      </a>
    </div>`)

    try {
        const { data, error } = await resend.emails.send({
            from: FROM_STORE(),
            to: [to],
            subject: `🛒 New order ${order.orderNumber} — ${money(order.total)}`,
            html,
        })
        if (error) {
            console.error("[mailer] Resend error sending new-order email:", error)
            return { sent: false, reason: "resend-error", error }
        }
        console.log(`[mailer] ✉️  New-order email sent to ${to} (${order.orderNumber}, id ${data?.id})`)
        return { sent: true, id: data?.id }
    } catch (err) {
        console.error("[mailer] Failed to send new-order email:", err.message)
        return { sent: false, reason: "exception", error: err.message }
    }
}

// ── Order status update (to the CUSTOMER) ──
// Sent every time the admin moves an order to a new status from the dashboard.
// Unlike the two notifications above — which only ever go to the store owner's
// own address — this goes to a real shopper, so it needs a verified domain in
// RESEND_FROM_EMAIL to actually deliver; Resend's shared onboarding@resend.dev
// sender can only reach the address that owns the Resend account. Same caveat
// as the verification codes below.

// One entry per status the admin can set. A status with no entry here (the
// legacy Viewed/Rejected) simply doesn't notify.
const STATUS_EMAIL = {
    Pending: {
        subject: (o) => `Order ${o.orderNumber} is back to pending`,
        heading: "Your order is pending again",
        lead: "We've moved your order back into review. We'll email you again as soon as it moves on.",
        note: "Nothing is needed from you — we'll take it from here.",
        accent: { bg: "#fffbeb", border: "#f59e0b", text: "#78350f" },
    },
    Dispatched: {
        subject: (o) => `Order ${o.orderNumber} is on its way`,
        heading: "Your order has been dispatched",
        lead: "Good news — your order has left us and is on its way to you.",
        note: "Delivery usually takes a few working days.",
        accent: { bg: "#eff6ff", border: "#3b82f6", text: "#1e3a8a" },
        // Only this status carries the carrier's tracking id, so only this one
        // renders the tracking panel below.
        showTracking: true,
    },
    Completed: {
        subject: (o) => `Order ${o.orderNumber} is complete`,
        heading: "Your order is complete",
        lead: `Your order is now marked as complete. Thanks for shopping with ${BRAND}!`,
        note: "If anything isn't right, just reply to this email and we'll sort it out.",
        accent: { bg: "#ecfdf5", border: "#10b981", text: "#065f46" },
    },
    Cancelled: {
        subject: (o) => `Order ${o.orderNumber} has been cancelled`,
        heading: "Your order was cancelled",
        lead: "Your order has been cancelled and will not be dispatched.",
        note: "Any payment taken for it will be refunded. Reply to this email if you have any questions.",
        accent: { bg: "#fef2f2", border: "#ef4444", text: "#7f1d1d" },
    },
}

// The courier's own tracking number. It is an EXTERNAL id — this site has no
// page that resolves it — so the email quotes it plainly and tells the customer
// to use it with the carrier, rather than linking anywhere.
function trackingBlockHtml(order) {
    const id = String(order?.trackingId || "").trim()
    if (!id) return ""
    return `
    <div style="border:2px dashed rgba(0,0,0,0.25);border-radius:10px;padding:16px;text-align:center;background:#f9fafb;margin:16px 0">
      <div style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Tracking number</div>
      <div style="font-family:monospace;font-size:22px;font-weight:bold;letter-spacing:2px;color:#111;word-break:break-all">${escapeHtml(id)}</div>
      <div style="color:#6b7280;font-size:12px;margin-top:8px">Use this tracking number on <a href="https://www.dpd.ie/track-my-parcel/" target="_blank" rel="noopener noreferrer">DPD's website</a> to track your delivery</div>
    </div>`
}

export async function sendOrderStatusEmail(order) {
    if (!order) return { sent: false, reason: "no-order" }

    const copy = STATUS_EMAIL[order.status]
    if (!copy) return { sent: false, reason: "status-not-notifiable" }

    const resend = getResend()
    if (!resend) {
        console.warn(`[mailer] RESEND_API_KEY not set — skipping status email for ${order.orderNumber}`)
        return { sent: false, reason: "not-configured" }
    }

    const to = order.customer?.email
    if (!to) return { sent: false, reason: "no-recipient" }

    const name = escapeHtml(order.customer?.name || "")
    const html = wrapEmail(`
    <h2 style="color:#111;margin:0 0 4px">${escapeHtml(copy.heading)}</h2>
    <p style="color:#6b7280;font-size:14px;margin:0 0 4px">
      ${name ? `Hi ${name}, r` : "R"}egarding order <strong style="color:#111">${escapeHtml(order.orderNumber)}</strong>
    </p>

    <p style="background:${copy.accent.bg};border:1px solid ${copy.accent.border};color:${copy.accent.text};font-size:13px;padding:10px 12px;border-radius:6px;margin:12px 0">
      ${escapeHtml(copy.lead)}
    </p>

    ${copy.showTracking ? trackingBlockHtml(order) : ""}

    <h3 style="color:#111;font-size:15px;margin:20px 0 6px">Your items</h3>
    <table style="width:100%;border-collapse:collapse">${(order.items || []).map(orderItemRowHtml).join("")}</table>

    <table style="width:100%;border-collapse:collapse;margin-top:16px">
      ${totalsRowHtml("Subtotal", money(order.subtotal))}
      ${order.discount > 0
            ? totalsRowHtml(
                `Discount${order.promoCode ? ` (${order.promoCode})` : ""}`,
                `− ${money(order.discount)}`,
                { color: "#059669" },
            )
            : ""
        }
      ${totalsRowHtml("Delivery", money(order.shipping))}
      ${order.tax > 0 ? totalsRowHtml("Tax", money(order.tax)) : ""}
      ${totalsRowHtml("Total", money(order.total), { bold: true })}
    </table>

    <p style="color:#6b7280;font-size:13px;margin-top:20px">${escapeHtml(copy.note)}</p>

    <div style="margin-top:20px">
      <a href="${STORE_URL()}/user" target="_blank" rel="noreferrer"
         style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 16px;border-radius:6px">
        View your orders →
      </a>
    </div>`)

    try {
        const { data, error } = await resend.emails.send({
            from: FROM_STORE(),
            to: [to],
            subject: copy.subject(order),
            html,
        })
        if (error) {
            console.error(`[mailer] Resend error sending status email for ${order.orderNumber}:`, error)
            return { sent: false, reason: "resend-error", error }
        }
        console.log(`[mailer] ✉️  "${order.status}" email sent to ${to} (${order.orderNumber}, id ${data?.id})`)
        return { sent: true, id: data?.id }
    } catch (err) {
        console.error(`[mailer] Failed to send status email for ${order.orderNumber}:`, err.message)
        return { sent: false, reason: "exception", error: err.message }
    }
}

// ── Customer email verification (4-digit code) ──
// NOTE: Resend's shared onboarding@resend.dev sender can only deliver to the
// address that owns the Resend account. Sending codes to real customers needs a
// verified domain in RESEND_FROM_EMAIL — until then this returns {sent:false}
// and the controller falls back to the dev code path.
export async function sendVerificationCodeEmail({ to, name, code, purpose }) {
    const resend = getResend()
    if (!resend) {
        console.warn("[mailer] RESEND_API_KEY not set — skipping verification email")
        return { sent: false, reason: "not-configured" }
    }
    if (!to) return { sent: false, reason: "no-recipient" }

    const COPY = {
        login: { heading: "Confirm it's you", lead: "Enter this code to finish signing in." },
        register: { heading: "Confirm your email", lead: "Enter this code to finish creating your account." },
        reset: {
            heading: "Reset your password",
            lead: "Enter this code to choose a new password.",
        },
        "email-change": {
            heading: "Confirm your new email",
            lead: "Enter this code to move your account to this address.",
        },
    }
    const { heading, lead } = COPY[purpose] ?? COPY.register
    // A reset email has to be recognisable in an inbox for what it is — a
    // customer who did not request one needs to notice.
    const subject = purpose === "reset" ? `${code} is your password reset code` : `${code} is your verification code`
    // The generic sign-off tells the recipient to ignore an unexpected email;
    // for a reset that is not enough on its own, since an unrequested reset
    // means someone else typed their address in.
    const footer =
        purpose === "reset"
            ? "The code expires in 10 minutes. If you didn't ask to reset your password, you can ignore this email — your current password still works and nothing has changed."
            : "The code expires in 10 minutes. If you didn't request it, you can ignore this email."

    try {
        const { data, error } = await resend.emails.send({
            from: FROM_STORE(),
            to: [to],
            subject,
            html: wrapEmail(
                `
    <h2 style="color:#111;margin:0 0 4px">${heading}</h2>
    <p style="color:#6b7280;font-size:14px;margin:0 0 20px">
      ${escapeHtml(name) ? `Hi ${escapeHtml(name)}, ` : ""}${lead}
    </p>
    <div style="border:2px dashed rgba(0,0,0,0.25);border-radius:10px;padding:20px;text-align:center;background:#f9fafb">
      <span style="font-family:monospace;font-size:34px;font-weight:bold;letter-spacing:10px;color:#111">${escapeHtml(code)}</span>
    </div>
    <p style="color:#6b7280;font-size:13px;margin-top:20px">
      ${footer}
    </p>`,
                { maxWidth: 520 },
            ),
        })
        if (error) {
            console.error("[mailer] Resend error sending verification code:", error)
            return { sent: false, reason: "resend-error", error }
        }
        console.log(`[mailer] ✉️  Verification code sent to ${to} (id ${data?.id})`)
        return { sent: true, id: data?.id }
    } catch (err) {
        console.error("[mailer] Failed to send verification code:", err.message)
        return { sent: false, reason: "exception", error: err.message }
    }
}

// Sends one digest email listing new products, each with an edit link to the
// store product page + the original source link. No-op (returns {sent:false})
// when there are no new products or no RESEND_API_KEY.
//
// This is the ONLY email sent from the admin's own address; all others use the
// store's main sender.
export async function sendNewProductsEmail(products) {
    if (!Array.isArray(products) || products.length === 0) return { sent: false, reason: "no-new-products" }

    const resend = getResend()
    if (!resend) {
        console.warn(`[mailer] RESEND_API_KEY not set — skipping new-product email for ${products.length} products`)
        return { sent: false, reason: "not-configured" }
    }

    const to = ADMIN_RECIPIENT()
    if (!to) {
        console.warn("[mailer] No ADMIN_NOTIFY_EMAIL / ADMIN_EMAIL recipient set — skipping new-product email")
        return { sent: false, reason: "no-recipient" }
    }

    try {
        const { data, error } = await resend.emails.send({
            from: FROM_ADMIN(),
            to: [to],
            subject: `🆕 ${products.length} new product${products.length === 1 ? "" : "s"} added to your store`,
            html: buildHtml(products),
        })
        if (error) {
            console.error("[mailer] Resend error:", error)
            return { sent: false, reason: "resend-error", error }
        }
        console.log(`[mailer] ✉️  New-product digest sent to ${to} (${products.length} products, id ${data?.id})`)
        return { sent: true, id: data?.id }
    } catch (err) {
        console.error("[mailer] Failed to send new-product email:", err.message)
        return { sent: false, reason: "exception", error: err.message }
    }
}
// ── Monthly "new products" reminder (customers who have ordered) ──
// Deliberately generic — no product list, just a nudge back to the shop. Every
// copy carries the recipient's own unsubscribe link (and the List-Unsubscribe
// headers mail providers require of bulk mail), since this is marketing rather
// than an order email.
function monthlyReminderHtml({ name, unsubscribeUrl }) {
    const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi there,"
    return wrapEmail(`
    <h2 style="color:#111;margin:0 0 12px">New products are landing at ${BRAND}</h2>
    <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 12px">${greeting}</p>
    <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 12px">
      Thanks again for shopping with us. Fresh phone accessories, cables, chargers,
      cases and gadgets arrive in our store every month — come and see what&apos;s new.
    </p>
    <div style="margin:20px 0">
      <a href="${STORE_URL()}" target="_blank" rel="noreferrer"
         style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:6px">
        See what&apos;s new →
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:24px 0 0">
      You&apos;re receiving this because you ordered from ${BRAND}.
      <a href="${unsubscribeUrl}" target="_blank" rel="noreferrer" style="color:#9ca3af">Unsubscribe</a>
    </p>`)
}

// recipients: [{ email, name, unsubscribeUrl }]. Sent through Resend's batch
// endpoint, 100 per request. `idempotencyKey` makes a retried batch a no-op on
// Resend's side, so a crash-and-rerun can never mail anyone twice.
export async function sendMonthlyReminderEmails(recipients, { idempotencyKey } = {}) {
    const resend = getResend()
    if (!resend) {
        console.warn(`[mailer] RESEND_API_KEY not set — skipping monthly reminder for ${recipients.length} customers`)
        return { sent: 0, failed: recipients.length, reason: "not-configured" }
    }

    let sent = 0
    let failed = 0
    for (let i = 0; i < recipients.length; i += 100) {
        const chunk = recipients.slice(i, i + 100)
        const emails = chunk.map((r) => ({
            from: FROM_STORE(),
            to: [r.email],
            subject: `New products are landing at ${BRAND} 📦`,
            html: monthlyReminderHtml(r),
            headers: {
                "List-Unsubscribe": `<${r.unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
        }))
        try {
            const { data, error } = await resend.batch.send(emails, {
                batchValidation: "permissive",
                ...(idempotencyKey ? { idempotencyKey: `${idempotencyKey}-${i / 100}` } : {}),
            })
            if (error) {
                console.error("[mailer] Resend error sending monthly reminder batch:", error)
                failed += chunk.length
            } else {
                const bad = data?.errors?.length ?? 0
                sent += chunk.length - bad
                failed += bad
            }
        } catch (err) {
            console.error("[mailer] Failed to send monthly reminder batch:", err.message)
            failed += chunk.length
        }
        // Resend's default rate limit is a few requests per second.
        if (i + 100 < recipients.length) await new Promise((r) => setTimeout(r, 600))
    }
    console.log(`[mailer] ✉️  Monthly reminder: ${sent} sent, ${failed} failed`)
    return { sent, failed }
}
