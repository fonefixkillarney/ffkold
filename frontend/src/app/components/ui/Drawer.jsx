"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Longest exit animation in globals.css (.drawer-panel[data-state="closed"])
// is 240ms. If `animationend` never arrives — dropped while the tab is
// backgrounded, the animation overridden by a consumer's own class, an
// interrupted transition — this timer unmounts the drawer regardless. A stuck,
// invisible full-screen overlay swallowing every click is the one failure this
// component must never produce, so the timeout is a hard guarantee, not a hint.
const EXIT_FALLBACK_MS = 450;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Drawer({
  open,
  onClose,
  label,
  side = "left",
  className = "",
  children,
}) {
  // The portal target only exists in the browser — same guard Modal.jsx uses.
  const [mounted, setMounted] = useState(false);

  // Single source of truth for what is in the DOM:
  //   "idle"    → nothing rendered at all
  //   "open"    → rendered, playing/holding the enter animation
  //   "closing" → still rendered, playing the exit animation
  const [phase, setPhase] = useState("idle");

  const panelRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      setPhase("open");
      return;
    }
    // Never jump straight to "idle" — unmounting on the same tick `open` flips
    // is exactly the instant-disappear bug this component exists to fix. Only
    // a drawer that is actually on screen has something to animate out.
    setPhase((prev) => (prev === "idle" ? "idle" : "closing"));
  }, [open]);

  const finishClosing = useCallback(() => {
    setPhase((prev) => (prev === "closing" ? "idle" : prev));
  }, []);

  // Fallback unmount, armed for the whole closing phase and cleared if the
  // drawer is reopened (or the component unmounts) mid-animation.
  useEffect(() => {
    if (phase !== "closing") return;
    // Under reduced motion the CSS animation is disabled, so `animationend`
    // will never fire at all: drop the node on the next tick instead of
    // leaving it up for the full fallback window.
    const delay = prefersReducedMotion() ? 0 : EXIT_FALLBACK_MS;
    const timer = setTimeout(finishClosing, delay);
    return () => clearTimeout(timer);
  }, [phase, finishClosing]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // While the drawer is open the page behind it must not move: only the panel
  // scrolls. `overflow: hidden` alone still lets touch scrolling through on
  // iOS, so the body is pinned at its current offset and restored (with the
  // scroll position) on close — including when this unmounts mid-animation,
  // since the cleanup is what restores it. Technique lifted from Sidebar.jsx.
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const { body } = document;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      Object.assign(body.style, previous);
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  // Fires for the enter animation too; `finishClosing` no-ops unless we are
  // actually closing. The target check ignores animations/transitions bubbling
  // up from the drawer's own content.
  const handleExitEnd = (event) => {
    if (event.target !== panelRef.current) return;
    finishClosing();
  };

  if (!mounted || phase === "idle" || typeof document === "undefined")
    return null;

  const state = phase === "closing" ? "closed" : "open";
  const panelAnimation =
    side === "right" ? "drawer-panel-right" : "drawer-panel";

  // Portalled to <body>: `position: fixed` anchors to the nearest transformed
  // ancestor, and the app shell carries the `animate-page-enter` transform,
  // which would otherwise re-anchor this overlay to the top of the document
  // rather than the viewport once the page is scrolled.
  return createPortal(
    <div
      className={`drawer-root fixed inset-0 z-50 flex ${side === "right" ? "justify-end" : ""}`}
      data-state={state}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <button
        type="button"
        data-state={state}
        aria-label={`Close ${label}`}
        className="drawer-backdrop absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
      />
      {/* h-dvh, not h-full: mobile browser chrome shrinks the visual viewport
          and the panel has to stay pinned top-to-bottom of what is actually on
          screen. Width/background/borders come from the caller's className. */}
      <div
        ref={panelRef}
        data-state={state}
        onAnimationEnd={handleExitEnd}
        onTransitionEnd={handleExitEnd}
        className={`${panelAnimation} relative z-10 flex h-dvh flex-col overscroll-contain shadow-xl ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
