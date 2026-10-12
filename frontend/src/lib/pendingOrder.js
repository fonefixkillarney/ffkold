// Redirect-based payment methods (Revolut Pay, Satispay — and any method on a
// phone that hands off to the provider's app) leave the site mid-payment and
// come back to /checkout/complete as a fresh page load, by which point the
// checkout form's React state is gone. The order payload is parked here just
// before confirming so the return page can still place the order.
//
// localStorage, not sessionStorage: the provider's app often reopens the return
// URL in a new tab, and a new tab starts a new session.
const KEY = "techstore-pending-order";

// The checkout form's own sessionStorage key (restored on mount). Shared here so
// the return page can hand the details back after a failed payment.
export const CHECKOUT_FORM_KEY = "techstore-checkout-form";

export function savePendingOrder(paymentIntentId, order) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ paymentIntentId, order }));
  } catch {
    /* ignore */
  }
}

export function getPendingOrder() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function clearPendingOrder() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
