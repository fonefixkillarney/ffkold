"use client";

import { useEffect, useRef } from "react";

// Remembers where a shopper was in a listing (which filters/page, and how far
// down) so the product page's "Back to <category>" link can drop them back on
// the exact same spot instead of the top of a freshly rendered grid.
//
// sessionStorage (not localStorage) on purpose: this is per-tab, throwaway
// navigation state — a new tab or a new session should start at the top.

const LAST_LISTING_KEY = "techstore:last-listing"; // { url, y } — updated as they scroll
const RESTORE_KEY = "techstore:restore-listing"; // { url, y } — one-shot request

function readJSON(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / storage full — scroll memory is a nicety, never a blocker.
  }
}

function clear(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}

// Canonical string for a listing URL. Query params are sorted so the same view
// always produces the same key no matter what order the params were written in.
export function listingUrl(pathname, params) {
  const sp = new URLSearchParams(params);
  sp.sort();
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

// The listing the shopper most recently looked at, or null. Read by the product
// page to decide where its Back link should point.
export function readLastListing() {
  const last = readJSON(LAST_LISTING_KEY);
  return last && typeof last.url === "string" && typeof last.y === "number" ? last : null;
}

// Ask the next mount of `url` to scroll to `y`. One-shot: whoever consumes it
// clears it, so a later plain visit to the same listing still starts at the top.
export function requestListingRestore(url, y) {
  writeJSON(RESTORE_KEY, { url, y });
}

// Used by a listing page: keeps its scroll offset recorded, and honours a
// restore request aimed at this exact URL. `ready` should be false while the
// products are still loading — the page is too short to scroll until then.
export function useListingScrollMemory(url, ready = true) {
  const pending = useRef(undefined); // undefined = request not read yet, null = none for us
  const done = useRef(false);

  useEffect(() => {
    if (!url) return;

    let frame = 0;
    let frozen = false;
    const record = () => {
      if (frame || frozen) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        writeJSON(LAST_LISTING_KEY, { url, y: window.scrollY });
      });
    };

    // Following a link out of the listing resets the scroll to the top *while
    // this page is still mounted*, which would record the shopper as having been
    // at y=0. So the offset is committed on the way out — before that reset —
    // and recording then stops until the listing is mounted again.
    const freeze = (event) => {
      const link = event.target?.closest?.("a[href]");
      if (!link || link.getAttribute("href") === "#") return;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      writeJSON(LAST_LISTING_KEY, { url, y: window.scrollY });
      frozen = true;
    };

    record(); // also covers a listing the shopper never scrolled
    window.addEventListener("scroll", record, { passive: true });
    document.addEventListener("click", freeze, true);
    return () => {
      window.removeEventListener("scroll", record);
      document.removeEventListener("click", freeze, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [url]);

  useEffect(() => {
    if (!url || done.current) return;

    if (pending.current === undefined) {
      const request = readJSON(RESTORE_KEY);
      pending.current = request && request.url === url ? request.y : null;
      if (request) {
        clear(RESTORE_KEY);
        // A request aimed at some other view means the link that suppressed
        // Next's scroll-to-top sent us somewhere unexpected — start at the top
        // rather than leaving the shopper at the previous page's offset.
        if (pending.current === null) window.scrollTo(0, 0);
      }
    }

    const target = pending.current;
    if (!target || !ready) return;

    // The grid usually renders in one pass (cards are fixed-height), but images
    // and fonts can still nudge the layout — so keep re-applying the offset for
    // up to ~1s until it sticks, and back off the moment the shopper scrolls.
    let frames = 0;
    let raf = 0;
    const teardown = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener("wheel", abort);
      window.removeEventListener("touchstart", abort);
      window.removeEventListener("keydown", abort);
    };
    // Only mark the restore finished once it has actually landed (or the shopper
    // took over). React re-runs this effect on mount in development, and that
    // second pass has to be able to pick the restore back up.
    const finish = () => {
      done.current = true;
      pending.current = null;
      teardown();
    };
    function abort() {
      finish();
    }
    const step = () => {
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.min(target, max));
      if (Math.abs(window.scrollY - target) > 2 && ++frames < 60) {
        raf = requestAnimationFrame(step);
      } else {
        finish();
      }
    };

    window.addEventListener("wheel", abort, { passive: true });
    window.addEventListener("touchstart", abort, { passive: true });
    window.addEventListener("keydown", abort);
    raf = requestAnimationFrame(step);

    return teardown;
  }, [url, ready]);
}
