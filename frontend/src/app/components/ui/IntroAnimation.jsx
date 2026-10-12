"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { markIntroDone } from "@/lib/introSignal";

// Full-screen neon boot sequence, played once per page load. The five-act
// timeline lives in globals.css under "Site intro — 5-second neon boot
// sequence"; this component owns only the phase machine and the scroll lock.
//
// Rendered straight into <body> from the root layout rather than portalled from
// a provider, for two reasons:
//   1. It is server-rendered, so the overlay is in the very first paint — a
//      portal only appears after hydration, which would flash the bare site
//      first and defeat the point of an intro.
//   2. It has to sit OUTSIDE the app shell's `animate-page-enter` wrapper: a
//      transformed ancestor becomes the containing block for `position: fixed`,
//      which is the same trap Modal/Drawer/LoadingScreen portal away from.
//
// It never replays on client-side navigation — the component stays mounted for
// the life of the document, so only a real page load starts the timers again.

// The sequence runs for HOLD_MS, then the power-off collapse takes FADE_MS:
// 4400 + 700 ≈ 5s on screen door to door. FADE_MS must outlast the 700ms
// collapse animation so the unmount lands after it, never during.
const HOLD_MS = 4400;
const FADE_MS = 700;

// Under reduced motion the acts are suppressed in CSS, so holding for the full
// five seconds would just be a still image sitting there. Cut it short.
const REDUCED_HOLD_MS = 1200;

// Light streaks for Act 2 — vertical position (%), direction (-1 left / 1
// right) and start delay (ms). Hard-coded rather than random: workflow scripts
// can't call Math.random, and more to the point a splash screen that looks
// different on every load is a splash screen nobody designed.
const STREAKS = [
  { y: 9, dir: -1, delay: 0 },
  { y: 17, dir: 1, delay: 320 },
  { y: 27, dir: -1, delay: 140 },
  { y: 36, dir: 1, delay: 520 },
  { y: 44, dir: -1, delay: 260 },
  { y: 57, dir: 1, delay: 60 },
  { y: 66, dir: -1, delay: 430 },
  { y: 74, dir: 1, delay: 200 },
  { y: 84, dir: -1, delay: 600 },
  { y: 92, dir: 1, delay: 380 },
];

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function IntroAnimation() {
  // "in" → playing · "out" → powering off · "done" → unmounted for good.
  const [phase, setPhase] = useState("in");

  useEffect(() => {
    if (phase !== "in") return;
    const hold = prefersReducedMotion() ? REDUCED_HOLD_MS : HOLD_MS;
    const t = setTimeout(() => setPhase("out"), hold);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "out") return;
    const t = setTimeout(() => setPhase("done"), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Hands off to whatever runs next — currently the promo posters, which wait
  // for this rather than racing the intro with a duplicate timer of their own.
  // Runs even though the component renders null at this point: the early return
  // is below every hook, so effects still fire.
  useEffect(() => {
    if (phase === "done") markIntroDone();
  }, [phase]);

  // Pin the page while the overlay is up so a stray scroll doesn't leave the
  // visitor halfway down a page they haven't seen yet. Deliberately on <html>
  // and not <body>: Modal and Drawer both own `document.body.style`, and two
  // independent locks writing the same properties restore each other's garbage.
  useEffect(() => {
    if (phase === "done" || typeof document === "undefined") return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [phase]);

  if (phase === "done") return null;

  return (
    <div className="intro-screen" data-state={phase === "out" ? "out" : "in"}>
      {/* Everything inside .intro-stage clears out as the power-off starts, so
          the picture folds onto a clean line instead of squashing the logo. */}
      <div className="intro-stage">
        {/* ACT 1 — power-on */}
        <div className="intro-boot" aria-hidden="true" />

        {/* ACT 2 — the tunnel */}
        <div className="intro-tunnel" aria-hidden="true">
          <div className="intro-plane intro-plane-floor" />
          <div className="intro-plane intro-plane-ceil" />
        </div>
        <div className="intro-horizon" aria-hidden="true" />
        <div className="intro-streaks" aria-hidden="true">
          {STREAKS.map((s) => (
            <span
              key={`${s.y}-${s.dir}`}
              style={{
                top: `${s.y}%`,
                animationDelay: `${s.delay}ms`,
                "--dir": String(s.dir),
              }}
            />
          ))}
        </div>

        {/* ACT 3 — the HUD */}
        <div className="intro-hud" aria-hidden="true">
          <div className="intro-hud-ring" />
          <div className="intro-hud-arc" />
          <div className="intro-hud-ticks" />
          <div className="intro-hud-inner" />
        </div>

        {/* ACT 3b + 4 — logo, charge bar, readout */}
        <div className="intro-core">
          <Image
            src="/FoneFix-Logo.png"
            alt="FoneFix Killarney"
            width={292}
            height={47}
            priority
            className="intro-logo"
          />
          <div className="intro-bar" aria-hidden="true">
            <span />
          </div>
          <p className="intro-caption">Killarney</p>
        </div>

        {/* Viewfinder frame, held across every act */}
        <div className="intro-frame" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      {/* ACT 5 — the line the picture collapses onto. Outside .intro-stage so
          it survives while everything else fades. */}
      <div className="intro-flatline" aria-hidden="true" />

      <button type="button" className="intro-skip" onClick={() => setPhase("out")}>
        Skip
      </button>
    </div>
  );
}
