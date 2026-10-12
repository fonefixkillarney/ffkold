// ── Money rules (mirrors be-eominio/utils/pricing.js) ────────────────────────
// The server recomputes every order and is the authority; these constants exist
// so the cart/checkout preview shows the SAME numbers and so the store can block
// an under-minimum order before the customer ever reaches payment.
//
//   • Orders below €10 cannot be checked out at all.
//   • €10 up to €25  → flat €5 delivery.
//   • €25 and above  → delivery is free.

export const MIN_ORDER_TOTAL = 10; // euros — carts below this can't check out
export const FREE_DELIVERY_THRESHOLD = 25; // euros — at/above this, delivery is free
export const DELIVERY_FEE = 5; // euros — flat fee below the threshold

export const round2 = (n) =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Delivery for a given (post-discount) goods amount. An empty cart never pays.
export function computeDelivery(amount, hasItems = true) {
  if (!hasItems) return 0;
  return amount < FREE_DELIVERY_THRESHOLD ? DELIVERY_FEE : 0;
}

// The goods subtotal is what the minimum is measured against — a promo discount
// can't push an otherwise-valid order below the minimum.
export function isBelowMinimum(subtotal) {
  return round2(subtotal) < MIN_ORDER_TOTAL;
}

// How much more is needed to unlock free delivery (0 once it's reached).
export function amountToFreeDelivery(amount) {
  return Math.max(0, round2(FREE_DELIVERY_THRESHOLD - amount));
}

export const MIN_ORDER_MESSAGE = `Minimum order is €${MIN_ORDER_TOTAL.toFixed(2)} — add a little more to check out.`;
