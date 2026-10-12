"use client";

import { ImageOff, ZoomIn } from "lucide-react";
import Image from "next/image";
import { useCallback, useMemo, useRef, useState } from "react";
import { fullSizeCandidates, thumbCandidates } from "@/lib/productImages";

// How much bigger the photo reads inside the zoom panel.
const ZOOM_FACTOR = 2.6;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// object-contain letterboxes the photo inside its box, so the zoom has to be
// mapped against the rectangle the photo actually paints into rather than the box
// — otherwise the panel drifts away from the cursor on any non-square photo.
// Until the image reports its natural size, assume it fills the box.
function paintedRect(boxWidth, boxHeight, natural) {
  if (!natural?.w || !natural?.h) {
    return { x: 0, y: 0, w: boxWidth, h: boxHeight };
  }
  const scale = Math.min(boxWidth / natural.w, boxHeight / natural.h);
  const w = natural.w * scale;
  const h = natural.h * scale;
  return { x: (boxWidth - w) / 2, y: (boxHeight - h) / 2, w, h };
}

export default function ImageGallery({ images }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [natural, setNatural] = useState(null);
  // Everything the hover state needs, computed in one pass per mouse move:
  // `lens` marks the slice being magnified, the background pair drives the panel.
  const [zoom, setZoom] = useState(null);
  // Only used at the widths where the panel has nowhere to sit (below lg): there
  // the photo keeps magnifying inside its own box, as it did before.
  const [inBoxOrigin, setInBoxOrigin] = useState(null);

  const boxRef = useRef(null);
  const panelRef = useRef(null);

  // Full-size first, stored URL as the fallback — see lib/productImages.js.
  const candidates = useMemo(
    () => fullSizeCandidates(images?.[activeIndex]),
    [images, activeIndex],
  );
  const activeImage = candidates[attempt];

  const showImage = (index) => {
    setActiveIndex(index);
    setAttempt(0);
    setImageFailed(false);
    setNatural(null);
    setZoom(null);
    setInBoxOrigin(null);
  };

  const handleMouseMove = useCallback(
    (event) => {
      // A tap on a touchscreen fires one synthetic mousemove and never a
      // mouseleave, so on a phone this used to leave the photo stuck at 2.6×
      // with no way back short of reloading. Zoom is a pointer affordance.
      if (
        typeof window !== "undefined" &&
        !window.matchMedia("(hover: hover) and (pointer: fine)").matches
      ) {
        return;
      }

      const box = boxRef.current?.getBoundingClientRect();
      if (!box?.width) return;
      const panel = panelRef.current?.getBoundingClientRect();

      const cursorX = clamp(event.clientX - box.left, 0, box.width);
      const cursorY = clamp(event.clientY - box.top, 0, box.height);

      // The panel is display:none below lg, which is what a zero-sized rect here
      // means — fall back to zooming inside the box at those widths.
      if (!panel?.width || !panel?.height) {
        setZoom(null);
        setInBoxOrigin(
          `${(cursorX / box.width) * 100}% ${(cursorY / box.height) * 100}%`,
        );
        return;
      }

      const photo = paintedRect(box.width, box.height, natural);
      const ratioX = clamp((cursorX - photo.x) / photo.w, 0, 1);
      const ratioY = clamp((cursorY - photo.y) / photo.h, 0, 1);

      // The panel shows the same photo, magnified: size it the way the panel would
      // contain it, then slide it so the point under the cursor sits in the middle
      // — clamped so no edge of the panel is ever left empty.
      const inPanel = paintedRect(panel.width, panel.height, natural);
      const zoomedW = inPanel.w * ZOOM_FACTOR;
      const zoomedH = inPanel.h * ZOOM_FACTOR;
      const offsetX = clamp(
        panel.width / 2 - ratioX * zoomedW,
        Math.min(0, panel.width - zoomedW),
        0,
      );
      const offsetY = clamp(
        panel.height / 2 - ratioY * zoomedH,
        Math.min(0, panel.height - zoomedH),
        0,
      );

      // Derived from the clamped offsets, not the raw cursor, so the lens always
      // frames exactly what the panel is showing.
      setZoom({
        lens: {
          left: photo.x + (-offsetX / zoomedW) * photo.w,
          top: photo.y + (-offsetY / zoomedH) * photo.h,
          width: Math.min(1, panel.width / zoomedW) * photo.w,
          height: Math.min(1, panel.height / zoomedH) * photo.h,
        },
        backgroundSize: `${zoomedW}px ${zoomedH}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      });
    },
    [natural],
  );

  const clearZoom = () => {
    setZoom(null);
    setInBoxOrigin(null);
  };

  const hasImage = !imageFailed && !!activeImage;

  return (
    <div className="w-full">
      {/* Anchor for the zoom panel — deliberately not overflow-hidden, the panel
          has to be free to sit outside this column and over the product info. */}
      <div className="relative">
        <div
          ref={boxRef}
          role="img"
          aria-label="Zoomable product image"
          className="relative h-64 w-full cursor-crosshair select-none overflow-hidden rounded-lg sm:h-80 lg:h-90 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-white"
          onMouseMove={handleMouseMove}
          onMouseLeave={clearZoom}
        >
          {hasImage ? (
            <Image
              src={activeImage}
              alt="Product"
              fill
              sizes="(max-width: 1024px) 100vw, 58vw"
              className="object-contain transition-transform duration-200 ease-out"
              style={
                inBoxOrigin
                  ? {
                      transform: `scale(${ZOOM_FACTOR})`,
                      transformOrigin: inBoxOrigin,
                    }
                  : undefined
              }
              unoptimized
              priority
              onLoad={(event) =>
                setNatural({
                  w: event.currentTarget.naturalWidth,
                  h: event.currentTarget.naturalHeight,
                })
              }
              // Walk to the next candidate (stored URL) before giving up, so a
              // product whose full-size variant doesn't exist still shows its icon.
              onError={() => {
                if (attempt < candidates.length - 1) setAttempt(attempt + 1);
                else setImageFailed(true);
              }}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500">
              <ImageOff size={34} />
              <span className="text-sm font-medium">Image unavailable</span>
            </div>
          )}

          {/* The lens: the slice of the photo the panel is magnifying. */}
          {zoom && (
            <div
              className="pointer-events-none absolute border-2 border-primary bg-primary/25"
              style={{
                left: `${zoom.lens.left}px`,
                top: `${zoom.lens.top}px`,
                width: `${zoom.lens.width}px`,
                height: `${zoom.lens.height}px`,
              }}
            />
          )}

          {hasImage && !zoom && !inBoxOrigin && (
            <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 hidden items-center gap-1.5 [@media(hover:hover)_and_(pointer:fine)]:flex rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
              <ZoomIn size={13} />
              Hover to zoom
            </span>
          )}
        </div>

        {/* The zoom panel. Always mounted at lg and up — hiding it with opacity
            rather than unmounting keeps it measurable on the very first mouse
            move, and `left-full` floats it clear of the image column entirely. */}
        <div
          ref={panelRef}
          aria-hidden="true"
          className={`pointer-events-none absolute top-0 left-full z-40 ml-3 hidden h-90 w-96 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl transition-opacity duration-150 lg:block xl:w-108 ${
            zoom ? "opacity-100" : "opacity-0"
          }`}
          style={
            zoom && hasImage
              ? {
                  backgroundImage: `url("${activeImage}")`,
                  backgroundSize: zoom.backgroundSize,
                  backgroundPosition: zoom.backgroundPosition,
                  backgroundRepeat: "no-repeat",
                }
              : undefined
          }
        />
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {images.map((img, i) => (
          <button
            key={img}
            type="button"
            onClick={() => showImage(i)}
            className={`relative h-16 w-16 shrink-0 overflow-hidden rounded border-2 bg-gray-50 dark:bg-gray-800 transition-all duration-200 ${i === activeIndex
                ? "border-primary"
                : "border-gray-200 dark:border-gray-700 hover:border-gray-400"
              }`}
            aria-label={`View product image ${i + 1}`}
          >
            <Thumb src={img} index={i} />
          </button>
        ))}
      </div>
    </div>
  );
}

// 64px of screen never needs the 500px+ photo, so the strip asks for the icon
// variant and only falls back to the stored URL if that one is missing. Its own
// state on purpose: a broken thumbnail must never blank out the main image.
function Thumb({ src, index }) {
  const [attempt, setAttempt] = useState(0);
  const candidates = useMemo(() => thumbCandidates(src), [src]);
  const url = candidates[attempt];

  if (!url) {
    return (
      <span className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-600">
        <ImageOff size={16} />
      </span>
    );
  }

  return (
    <Image
      src={url}
      alt={`View ${index + 1}`}
      fill
      sizes="64px"
      className="object-contain"
      unoptimized
      onError={() => setAttempt(attempt + 1)}
    />
  );
}
