"use client";

import { useCallback, useEffect, useState } from "react";

// The open → closing → gone state machine shared by every overlay that has to
// animate itself OUT. Extracted from Modal so the promo-poster overlay behaves
// identically instead of growing a second, subtly different copy.
//
// The contract, and the reason this exists at all: an overlay must never
// unmount on the same tick `open` flips false — that is what makes a dialog
// blink out of existence instead of animating away. It also must never get
// STUCK mounted, because a stranded full-screen overlay swallows every click on
// the page behind it. So a "closing" phase holds the node in the DOM while the
// exit animation plays, and a hard fallback timer removes it even if
// `animationend` never arrives (tab backgrounded, animation overridden by a
// consumer's own class, reduced motion disabling it outright).

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function useDismissPhase(open, exitFallbackMs = 400) {
  // The portal target only exists in the browser.
  const [mounted, setMounted] = useState(false);

  //   "idle"    → nothing rendered at all
  //   "open"    → rendered, playing/holding the enter animation
  //   "closing" → still rendered, playing the exit animation
  const [phase, setPhase] = useState("idle");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      setPhase("open");
      return;
    }
    // Only an overlay that is actually on screen has something to animate out.
    setPhase((prev) => (prev === "idle" ? "idle" : "closing"));
  }, [open]);

  const finishClosing = useCallback(() => {
    setPhase((prev) => (prev === "closing" ? "idle" : prev));
  }, []);

  useEffect(() => {
    if (phase !== "closing") return;
    // Under reduced motion the CSS animation is off, so `animationend` never
    // fires: drop the node on the next tick rather than holding it for the
    // full fallback window.
    const delay = prefersReducedMotion() ? 0 : exitFallbackMs;
    const timer = setTimeout(finishClosing, delay);
    return () => clearTimeout(timer);
  }, [phase, finishClosing, exitFallbackMs]);

  return {
    // Render nothing at all unless this is true.
    visible: mounted && phase !== "idle",
    // Goes on the root element as `data-state`; the CSS keys its exit off it.
    state: phase === "closing" ? "closed" : "open",
    // Call from the panel's onAnimationEnd to unmount as soon as the exit ends.
    finishClosing,
  };
}
