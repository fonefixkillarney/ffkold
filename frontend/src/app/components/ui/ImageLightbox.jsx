"use client";

import { ImageOff, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { fullSizeCandidates } from "@/lib/productImages";

export default function ImageLightbox({ src, alt, onClose }) {
  const [status, setStatus] = useState("loading");
  // This *is* the "larger photo" view, so it always asks for the full-size
  // variant of the photo first and only falls back to the stored (icon-sized)
  // URL if the source site has nothing bigger — see lib/productImages.js.
  const candidates = useMemo(() => fullSizeCandidates(src), [src]);
  const [attempt, setAttempt] = useState(0);
  const url = candidates[attempt];

  useEffect(() => {
    setStatus("loading");
    setAttempt(0);
  }, [src]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined" || !src) return null;

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape-to-close is wired via the keydown listener above
    <div
      className="fixed inset-0 z-100 flex! items-center! justify-center! bg-black/80 p-4 sm:p-8 animate-fade-up"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Image preview"}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 sm:top-6 sm:right-6 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors duration-200"
        aria-label="Close image preview"
      >
        <X size={22} />
      </button>

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, Escape still closes via the listener above */}
      <div
        className="relative flex! h-[90vh]! w-[90vw]! items-center! justify-center!"
        onClick={(e) => e.stopPropagation()}
      >
        {status === "loading" && (
          <div className="absolute h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        )}

        {status === "error" ? (
          <div className="flex flex-col items-center gap-2 text-gray-300">
            <ImageOff size={40} />
            <span className="text-sm font-medium">Image unavailable</span>
          </div>
        ) : (
          // biome-ignore lint/performance/noImgElement: intrinsic-size auto-sizing isn't achievable with next/image's fill mode without known dimensions, and this never affects LCP since it only renders after a user click
          <img
            key={url}
            src={url}
            alt={alt}
            className={`object-contain rounded-lg h-[90vh]! w-[90vw]! shadow-2xl transition-opacity duration-200 ${
              status === "loaded" ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => setStatus("loaded")}
            onError={() => {
              if (attempt < candidates.length - 1) setAttempt(attempt + 1);
              else setStatus("error");
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
