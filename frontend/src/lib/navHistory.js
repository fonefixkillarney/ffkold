"use client";

// How deep into this tab's history the shopper is, and which page they came from.
//
// A product page's "Back" control needs to tell two situations apart:
//   - they walked here from somewhere on our site  → go back to that exact page,
//     whatever it was (landing page, a filtered listing, wishlist, another product)
//   - this product page is the first thing the tab ever opened (shared link, new
//     tab, Google result) → there is nothing behind it, so fall back to a real link
// history.back() cannot answer that question on its own, hence this counter.
//
// sessionStorage, like scrollMemory: per-tab throwaway navigation state.

const DEPTH_KEY = "techstore:nav-depth";
const PREV_KEY = "techstore:nav-prev";

function read(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Private mode / storage full — back navigation still works, it just falls
    // back to the category link instead of history.back().
  }
}

function depth() {
  const raw = Number(read(DEPTH_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

// Called once per in-app navigation by NavHistoryTracker. `popped` marks a
// back/forward step, which unwinds the counter instead of advancing it.
export function recordNavigation({ from, popped }) {
  if (popped) {
    write(DEPTH_KEY, String(Math.max(0, depth() - 1)));
    // After a back/forward step, whatever now sits behind us is a page this tab
    // has no record of — better to say "unknown" than to name the wrong one.
    write(PREV_KEY, null);
    return;
  }
  write(DEPTH_KEY, String(depth() + 1));
  write(PREV_KEY, from ?? null);
}

// True when there is a page of ours behind this one that history.back() will
// actually reach. The history.length check matters because browsers copy
// sessionStorage into a tab opened with target="_blank" — that tab inherits a
// depth it cannot honour, and back() there would do nothing at all.
export function canGoBack() {
  if (typeof window === "undefined") return false;
  return depth() > 0 && window.history.length > 1;
}

// The URL we navigated here from, when it's known — used only to name the Back
// button, never to navigate (history.back() is what actually moves).
export function readPreviousPage() {
  return read(PREV_KEY);
}
