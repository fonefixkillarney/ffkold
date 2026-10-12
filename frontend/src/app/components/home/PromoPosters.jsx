"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onIntroDone } from "@/lib/introSignal";
import useDismissPhase from "@/lib/useDismissPhase";

const POSTERS = [
  {
    key: "next-day-delivery",
    eyebrow: "Order before 2PM",
    title: "Next Day Delivery",
    sub: (
      <>
        if you order before <strong>2PM</strong>
      </>
    ),
    badge: "BEFORE 2PM",
    urgency: "Order today — get it tomorrow",
  },
  {
    key: "launch-offer",
    eyebrow: "Our new web — limited offer",
    title: "New Website Launch Offer",
    sub: (
      <>
        for the whole month of <strong>October</strong>
      </>
    ),
    badge: "10% OFF",
    urgency: "Hurry before it's too late!",
  },
  {
    key: "delivery-rules",
    eyebrow: "Orders & delivery",
    title: "Free Delivery Over €25",
    sub: (
      <>
        minimum checkout <strong>€10</strong>
      </>
    ),
    // Longer than the other badges — the compact modifier keeps it on one line.
    badge: "€5 DELIVERY CHARGES UNDER €25",
    badgeClass: "hero-offer-badge-compact",
    urgency: "Spend €25 or more and delivery is on us",
  },
];

// Deterministic spark positions — no Math.random, which would differ between
// the server and client render and break hydration.
const SPARKS = [
  { top: "10%", left: "9%", animationDelay: "0s" },
  { top: "22%", left: "24%", animationDelay: "0.7s" },
  { top: "9%", right: "13%", animationDelay: "1.3s" },
  { top: "30%", right: "7%", animationDelay: "0.4s" },
  { bottom: "22%", left: "13%", animationDelay: "1.7s" },
  { bottom: "34%", left: "31%", animationDelay: "0.9s" },
  { bottom: "18%", right: "19%", animationDelay: "0.2s" },
  { bottom: "38%", right: "30%", animationDelay: "1.1s" },
];

// Matches the exit animation in globals.css (.poster-panel), with headroom.
const EXIT_FALLBACK_MS = 420;

// How long each poster stays up before the next slides in on its own. Also
// drives the fill on the active progress dot, so the two can't drift apart.
const AUTO_ADVANCE_MS = 4000;

// The intro plays on every route, but these are a shopper's welcome — an admin
// reloading the orders table does not want three promos in the way each time.
// Same reasoning and the same list as LoadingScreen: any NEW route that isn't
// part of the storefront belongs here too.
const HIDDEN_PREFIXES = ["/admin", "/user", "/register"];

const isHiddenRoute = (pathname) =>
  HIDDEN_PREFIXES.some((prefix) => pathname?.startsWith(prefix));

export default function PromoPosters() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  // 1 after Next, -1 after Back — the card slides in from the matching side.
  const [direction, setDirection] = useState(1);
  // Once the visitor has skipped or finished, nothing reopens the overlay for
  // the life of the document — including a route change.
  const doneRef = useRef(false);

  const panelRef = useRef(null);
  const { visible, state, finishClosing } = useDismissPhase(open, EXIT_FALLBACK_MS);

  const hidden = isHiddenRoute(pathname);

  const dismiss = useCallback(() => {
    doneRef.current = true;
    setOpen(false);
  }, []);

  // Wait for the opening animation rather than running a timer of our own, so
  // the two can never drift apart if the intro's length is retuned.
  useEffect(() => {
    if (hidden || doneRef.current) return;
    return onIntroDone(() => {
      if (!doneRef.current) setOpen(true);
    });
  }, [hidden]);

  // Navigating into the admin/user panels while the overlay is up closes it.
  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, dismiss]);

  // Auto-advance, wrapping from the last poster back to the first; Skip or
  // Done still closes it. Keyed on `index` so every change — this timer's own
  // or a manual Next/Back — gives the poster now showing its full 4 seconds.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setDirection(1);
      setIndex((i) => (i + 1) % POSTERS.length);
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [open, index]);

  const handleExitEnd = (event) => {
    if (event.target !== panelRef.current) return;
    finishClosing();
  };

  if (!visible) return null;

  const poster = POSTERS[index];
  const isFirst = index === 0;
  const isLast = index === POSTERS.length - 1;

  const next = () => {
    if (isLast) {
      dismiss();
      return;
    }
    setDirection(1);
    setIndex((i) => i + 1);
  };

  // For the visitor who hit Next by accident and wants the last offer back.
  const back = () => {
    if (isFirst) return;
    setDirection(-1);
    setIndex((i) => i - 1);
  };

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape-to-skip is wired via the keydown listener above
    <div
      className="modal-root poster-root"
      data-state={state}
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-label={`Offer ${index + 1} of ${POSTERS.length}: ${poster.title}`}
    >
      <div className="" />
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, Escape still skips via the listener above */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only, not an interactive control itself */}
      <div
        ref={panelRef}
        onAnimationEnd={handleExitEnd}
        className="modal-panel poster-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="poster-actions">
          <button type="button" className="poster-btn" onClick={dismiss}>
            Skip
          </button>
          {/* Next stays anchored at the far right, so Back appears right beside
              it — one short move away after an accidental Next. */}
          {!isFirst && (
            <button type="button" className="poster-btn" onClick={back}>
              <ArrowLeft size={14} />
              Back
            </button>
          )}
          <button type="button" className="poster-btn poster-btn-primary" onClick={next}>
            {isLast ? "Done" : "Next"}
            <ArrowRight size={14} />
          </button>
        </div>

        <div className="poster-stage">
          {/* Keyed on the poster so React remounts the card and the enter
              animation in globals.css replays on every Next and Back. */}
          <div
            key={poster.key}
            className="hero-offer poster-card"
            style={{ "--poster-dir": direction }}
          >
            <div className="hero-offer-rays" />
            {SPARKS.map((style) => (
              <span
                key={`${style.top || style.bottom}-${style.left || style.right}`}
                className="hero-offer-spark"
                style={style}
              />
            ))}
            <div className="hero-offer-content">
              <p className="hero-offer-eyebrow">{poster.eyebrow}</p>
              <h2 className="hero-offer-title">{poster.title}</h2>
              <p className="hero-offer-sub">{poster.sub}</p>
              <div className={`hero-offer-badge ${poster.badgeClass || ""}`}>
                {poster.badge}
              </div>
              <p className="hero-offer-urgency">{poster.urgency}</p>
            </div>
          </div>

          {/* Which of the three you are on, so Next has a visible end. The
              active dot fills over AUTO_ADVANCE_MS to show when it moves on. */}
          <div
            className="poster-dots"
            aria-hidden="true"
            style={{ "--poster-interval": `${AUTO_ADVANCE_MS}ms` }}
          >
            {POSTERS.map((p, i) => (
              <span
                key={p.key}
                className={`poster-dot ${i === index ? "poster-dot-active" : ""}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
