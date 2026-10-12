"use client";

import { ImageOff } from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";
import { imageCandidates } from "@/lib/productImages";

export default function ProductImage({
  src,
  alt,
  className = "",
  imageClassName = "",
  priority = false,
  sizes = "(max-width: 768px) 100vw, 33vw",
  // "stored" uses exactly the URL the database holds. "thumb" prefers the source
  // site's small icon variant (plenty at a few dozen pixels, and a fraction of the
  // bytes), "full" prefers the full-size one. Both fall back to the stored URL if
  // the variant they asked for doesn't exist — see lib/productImages.js.
  variant = "stored",
  // The fill behind a transparent/letterboxed photo. Overridable because the
  // glassy surfaces supply their own plate (`.glass-media`, a near-white panel
  // in BOTH themes) and the default `dark:bg-gray-800` would paint a dark box
  // back over it. Those callers pass `surface="bg-transparent"`.
  surface = "bg-gray-50 dark:bg-gray-800",
}) {
  const candidates = useMemo(
    () => imageCandidates(src, variant),
    [src, variant],
  );
  // Which candidate we're on, tagged with the src it belongs to so a new photo
  // starts the walk over — deriving it here rather than resetting in an effect
  // keeps the first render of a new src on its preferred URL.
  const [tried, setTried] = useState({ src, attempt: 0 });
  const attempt = tried.src === src ? tried.attempt : 0;
  const url = candidates[attempt];
  const failed = !url;

  return (
    <div className={`relative overflow-hidden ${surface} ${className}`}>
      {!failed ? (
        <Image
          key={url}
          src={url}
          alt={alt}
          fill
          sizes={sizes}
          className={imageClassName}
          unoptimized
          priority={priority}
          onError={() => setTried({ src, attempt: attempt + 1 })}
        />
      ) : (
        // Tinted from the surface rather than a fixed grey, so the placeholder
        // stays a soft inset on whatever plate it lands on — including the
        // near-white `.glass-media`, where `dark:bg-gray-800` used to punch a
        // dark rectangle through the middle of a light card.
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/5 dark:bg-black/20 text-gray-500 dark:text-gray-400">
          <ImageOff size={24} />
          <span className="px-3 text-center text-xs font-medium">
            Image unavailable
          </span>
        </div>
      )}
    </div>
  );
}
