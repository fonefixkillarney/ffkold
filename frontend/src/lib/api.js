const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api"

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

// The catalogue response is cacheable (see Cache-Control in the products
// controller), so `fresh: true` is how a caller that must see a just-made change
// — the admin approving a product — opts out of that cache.
export async function fetchProducts(params = {}) {
  const qs = new URLSearchParams()
  if (params.category) qs.set("category", params.category)
  if (params.subcategory) qs.set("subcategory", params.subcategory)
  if (params.search) qs.set("search", params.search)
  const query = qs.toString()
  const { data } = await apiFetch(
    `/products${query ? `?${query}` : ""}`,
    params.fresh ? { cache: "no-store" } : {},
  )
  return data ?? []
}

// `token` is optional and only matters for an ADMIN token: the backend 404s a
// not-yet-approved product for everyone else, so this is what lets the admin
// open a pending product from the approval queue and look at it before approving.
export async function fetchProduct(id, token) {
  const { data } = await apiFetch(
    `/products/${id}`,
    token
      ? { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
      : {},
  )
  return data
}

export async function fetchCategories() {
  const { data } = await apiFetch("/categories")
  return data ?? []
}

export async function fetchBanners() {
  const { data } = await apiFetch("/banners")
  return data ?? []
}

async function authFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options)
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || `API error ${res.status}`)
  return data
}

// ── Customer accounts (backend: models/User.js + routes/userRoutes.js) ──
// register and login are step 1: they mail a 4-digit code and resolve to
// { requiresVerification, email } — no token. verifyUserCode is what returns
// { token, data }. (`devCode` comes back only when the backend has no mail
// transport configured and isn't running in production.)
export async function registerUserAccount({ name, email, password }) {
  return authFetch("/user/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  })
}

export async function loginUserAccount(email, password) {
  return authFetch("/user/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
}

export async function verifyUserCode(email, code) {
  return authFetch("/user/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  })
}

// "Sign in with Google": trades a Google ID token for { token, data, created } in
// one step — Google has already proven the address, so there is no code step.
export async function googleSignInAccount(credential) {
  return authFetch("/user/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  })
}

export async function resendUserCode(email) {
  return authFetch("/user/resend-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  })
}

// ── Password reset ──
// Same two-step shape as login: requestPasswordReset mails a 4-digit code and
// establishes no session, resetUserPassword swaps code + new password for
// { token, data }. The backend answers requestPasswordReset identically for
// every address (so it can't be used to find out which emails have accounts),
// which means a "sent" result here is NOT a promise that the account exists.
export async function requestPasswordReset(email) {
  return authFetch("/user/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  })
}

export async function resetUserPassword(email, code, password) {
  return authFetch("/user/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code, password }),
  })
}

export async function fetchUserMe(token) {
  const { data } = await authFetch("/user/me", {
    headers: { Authorization: `Bearer ${token}` },
  })
  return data
}

// ── Account settings (/user/settings) ──
// `changes` = any of { name, orderUpdates, saleAlerts }. Email isn't accepted
// here — it moves through requestUserEmailChange / confirmUserEmailChange, so the
// new address is proven before the account switches to it.
export async function updateUserProfile(changes, token) {
  const { data } = await authFetch("/user/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(changes),
  })
  return data
}

// Mails a 4-digit code to the NEW address and resolves to { email, devCode? }.
// Calling it again with the same address is the resend.
export async function requestUserEmailChange(email, token) {
  return authFetch("/user/email-change", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email }),
  })
}

// Resolves to { token, data } — a fresh token, because the old one names the old
// address.
export async function confirmUserEmailChange(code, token) {
  return authFetch("/user/email-change/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  })
}

export async function loginAdmin(email, password) {
  return authFetch("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
}

export async function fetchAdminMe(token) {
  const { data } = await authFetch("/admin/me", {
    headers: { Authorization: `Bearer ${token}` },
  })
  return data
}

// `prices` = { price, originalPrice } — either field optional, both editable
// by the admin (originalPrice is the crossed-out "old" price from the source site).
export async function updateProductPrice(id, prices, token) {
  const { data } = await authFetch(`/products/${id}/price`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(prices),
  })
  return data
}

// `change` = { stock: N } to set units (0 = out of stock; the scraper then leaves
// it alone), or { followSupplier: true } to hand stock back to the scraper.
export async function updateProductStock(id, change, token) {
  const { data } = await authFetch(`/products/${id}/stock`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(change),
  })
  return data
}

// ── Approval queue (/admin/upcoming-products) ──
// Everything scraped since the last review, split into the two tables the page
// renders. Products and banners here are invisible to shoppers until approved.
export async function fetchPendingItems(token) {
  const { data } = await authFetch("/pending", {
    headers: { Authorization: `Bearer ${token}` },
  })
  return data ?? { products: [], banners: [] }
}

export async function approveProduct(id, token) {
  const { data } = await authFetch(`/products/${id}/approve`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  })
  return data
}

export async function approveBanner(id, token) {
  const { data } = await authFetch(`/banners/${id}/approve`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  })
  return data
}

// Permanent — the backend also writes a tombstone so no rescrape can restore it.
export async function deleteProduct(id, token) {
  const { data } = await authFetch(`/products/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
  return data
}

// First-order promo (the balloon code): the code itself is public, the
// backend gates eligibility per email at validate + order-create time.
export async function fetchFirstOrderPromo() {
  const { data } = await apiFetch("/orders/promo")
  return data
}

export async function validatePromoCode(code, email) {
  const { data } = await authFetch("/orders/promo/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, email }),
  })
  return data
}

export async function createOrder(order) {
  const { data } = await authFetch("/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  })
  return data
}

// ── Stripe payment ──
// Whether Stripe is live yet + the publishable key to init Stripe.js with.
export async function fetchPaymentConfig() {
  const { data } = await apiFetch("/payment/config")
  return data
}

// Server recomputes the amount from DB prices + promo + the delivery rule and
// returns a PaymentIntent client secret (or configured:false + the price
// breakdown when Stripe keys aren't set yet). Delivery is derived server-side,
// so there is nothing shipping-related to send.
export async function createPaymentIntent({ items, promoCode, email, customer }) {
  const { data } = await authFetch("/payment/create-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, promoCode, email, customer }),
  })
  return data
}

export async function fetchOrders(token) {
  const { data } = await authFetch("/orders", {
    headers: { Authorization: `Bearer ${token}` },
  })
  return data ?? []
}

export async function deleteOrder(id, token) {
  const { data } = await authFetch(`/orders/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
  return data
}

// Resolves to { order, emailed } — `emailed` is the backend telling us whether
// the customer-facing status email actually left (it is false when RESEND_API_KEY
// isn't configured), so the dashboard can say so instead of implying it did.
export async function updateOrderStatus(id, status, token) {
  const { data, emailed } = await authFetch(`/orders/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  })
  return { order: data, emailed: Boolean(emailed) }
}

// The dispatch step. Attaches the courier's tracking id AND moves the order to
// Dispatched in one request, so the two can't drift apart. Resolves to the same
// { order, emailed } shape as updateOrderStatus — the email that goes out is the
// Dispatched one, with the tracking id printed in it.
export async function dispatchOrderWithTracking(id, trackingId, token) {
  const { data, emailed } = await authFetch(`/orders/${id}/tracking`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ trackingId }),
  })
  return { order: data, emailed: Boolean(emailed) }
}

export async function lookupOrder(orderNumber) {
  const { data } = await authFetch(`/orders/lookup/${orderNumber}`)
  return data
}
