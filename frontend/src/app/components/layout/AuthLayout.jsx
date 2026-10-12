"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

// Shared chrome for every auth route (register/login, admin login, and any
// reset-password screen added later): the form on the left, a slideshow on the
// right. Each route gets it by re-exporting from its own layout.jsx.
const IMAGES = [
  {
    src: "https://images.unsplash.com/photo-1595246135406-803418233494?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    alt: "Photo 1",
  },
  {
    src: "https://images.unsplash.com/photo-1595246140625-573b715d11dc?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    alt: "Photo 2",
  },
  {
    src: "https://images.unsplash.com/photo-1782405183299-f177ddb3f437?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    alt: "Photo 3",
  },
  {
    src: "https://images.unsplash.com/photo-1656543802898-41c8c46683a7?q=80&w=1171&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    alt: "Photo 4",
  }
];

const SLIDE_MS = 4000;

// `backdrop` decides what sits behind the form. "glass" gives the storefront
// sign-up / reset screens the aurora and the blurred slide wash their glass
// cards need; "plain" keeps the flat white/black the ADMIN login was signed off
// with — that screen shares this layout but not the storefront's new theme.
export default function AuthLayout({ children, backdrop = "glass" }) {
  const [index, setIndex] = useState(0);
  const glassy = backdrop === "glass";

  // Keyed on `index` rather than run once, so clicking a dot restarts the full
  // interval instead of leaving the next auto-advance a few hundred ms away.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `index` is the timer reset trigger, not a value the effect reads
  useEffect(() => {
    const timer = setTimeout(
      () => setIndex((prev) => (prev + 1) % IMAGES.length),
      SLIDE_MS,
    );
    return () => clearTimeout(timer);
  }, [index]);

  return (
    <section className="flex min-h-screen">
      {/* Left: the form. Full width until md, where the slideshow appears.
          The form itself is a glass card, and glass needs something behind it or
          it reads as a plain translucent box. Two layers supply that: the same
          slide the right-hand panel is showing, blurred to a colour wash, and
          `.glass-shell`'s aurora underneath it as the floor for when an image
          is still loading (or fails). */}
      <div
        className={`relative flex w-full items-center justify-center overflow-hidden bg-white md:w-1/2 dark:bg-black ${glassy ? "glass-shell" : ""}`}
      >
        {glassy && (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            {IMAGES.map((image, i) => (
              <div
                key={image.src}
                className="absolute inset-0 transition-opacity duration-700 ease-in-out"
                style={{ opacity: i === index ? 1 : 0 }}
              >
                <Image
                  src={image.src}
                  alt=""
                  fill
                  sizes="50vw"
                  aria-hidden="true"
                  className="scale-125 object-cover opacity-30 blur-3xl dark:opacity-40"
                />
              </div>
            ))}
          </div>
        )}

        <div className="relative z-10 w-full">{children}</div>
      </div>

      {/* Right: slideshow */}
      <div className="relative hidden w-1/2 overflow-hidden bg-black md:block">
        {/* Every slide is mounted and stacked; only opacity/scale change. That
            is what makes the two images cross-fade — swapping a single <Image>
            src would hard-cut, and unmounting the outgoing slide would leave
            nothing to fade against. */}
        {IMAGES.map((image, i) => (
          <div
            key={image.src}
            aria-hidden={i !== index}
            className="absolute inset-0 transition-all duration-700 ease-in-out"
            style={{
              opacity: i === index ? 1 : 0,
              transform: i === index ? "scale(1)" : "scale(1.08)",
            }}
          >
            <Image
              src={image.src}
              alt={image.alt}
              fill
              sizes="50vw"
              className="object-cover"
              priority={i === 0}
            />
          </div>
        ))}

        {/* Softens the seam where the panel meets the form side. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-l from-transparent to-black/20" />

        <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 gap-2">
          {IMAGES.map((image, i) => (
            <button
              key={image.src}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show ${image.alt}`}
              aria-current={i === index}
              className={`rounded-full transition-all duration-500 ${i === index
                  ? "h-2 w-5 bg-white"
                  : "h-2 w-2 bg-white/40 hover:bg-white/60"
                }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
