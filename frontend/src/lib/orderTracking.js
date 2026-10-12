// Tracks orders placed from this browser so the customer can see their own
// order status on /user without needing a login — mirrors the localStorage
// pattern already used for cart/wishlist. Order numbers are unguessable
// random tokens, so storing/looking them up this way is safe.
const KEY = "techstore-order-numbers";
const MAX_TRACKED = 20;

export function saveOrderNumber(orderNumber) {
  try {
    const existing = getSavedOrderNumbers();
    const next = [orderNumber, ...existing.filter((n) => n !== orderNumber)].slice(0, MAX_TRACKED);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function getSavedOrderNumbers() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}
