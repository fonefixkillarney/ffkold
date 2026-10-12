// The source site (Volusion) publishes every product photo at several sizes,
// distinguished only by the number just before the extension:
//
//   …-1.jpg   listing icon — 200x200, visibly blurry once it's blown up
//   …-2.jpg   the real photo — measured 500x500 to 1200x1200
//   …-3.jpg+  further gallery shots, also full size
//
// The scraper has an upgrade pass that swaps the icon for the -2…-5 gallery, but
// products saved before it ran (~1,600 of them) still carry nothing but the icon,
// which is why detail pages looked soft. Instead of waiting on a rescrape, the
// views that show a photo big ask for the full-size variant first and fall back to
// whatever the database actually stored — the CDN answers a missing variant with a
// real 404, so the <img> onError handler is a reliable signal.

const VARIANT_RE = /-(\d+)(\.(?:jpe?g|png|gif|webp))$/i;

// Best-first URLs for showing a photo large (product page, zoom panel, lightbox).
export function fullSizeCandidates(src) {
  if (!src) return [];
  const match = src.match(VARIANT_RE);
  // Only the icon needs upgrading: -2 and up are already full size, and anything
  // that doesn't follow the convention (NoPhoto.gif, say) is left alone.
  if (!match || match[1] !== "1") return [src];
  return [src.replace(VARIANT_RE, "-2$2"), src];
}

// Best-first URLs for a small thumbnail (the 64px gallery strip, list-view
// thumbs). Going the other way — the 200x200 icon is plenty at those sizes and
// saves pulling a 150-500KB photo per thumbnail.
export function thumbCandidates(src) {
  if (!src) return [];
  const match = src.match(VARIANT_RE);
  if (!match || match[1] === "1") return [src];
  return [src.replace(VARIANT_RE, "-1$2"), src];
}

export function imageCandidates(src, variant) {
  if (variant === "full") return fullSizeCandidates(src);
  if (variant === "thumb") return thumbCandidates(src);
  return src ? [src] : [];
}
