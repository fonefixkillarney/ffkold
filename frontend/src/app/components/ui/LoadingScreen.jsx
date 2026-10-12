"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useData } from "@/context/DataContext";

// Full-screen overlay shown on first load while DataContext fetches products/
// categories/banners from MongoDB. Fades out once the data has arrived, then
// unmounts entirely so it can never intercept clicks.
// Portaled to <body> — the page wrapper's entrance animation leaves a
// transform behind, which would otherwise re-anchor position:fixed to the
// wrapper instead of the viewport (same trap Modal.jsx works around).
export default function LoadingScreen() {
  const { loading } = useData();
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => setVisible(false), 300);
    return () => clearTimeout(t);
  }, [loading]);

  // Admin/user panels and registration don't consume the product catalog —
  // blocking them behind the products fetch (minutes, if a scrape is mid-run)
  // would recreate the slow-load problem this overlay exists to mask. This is a
  // click-blocker, not just cosmetic: the overlay swallows real clicks, so any
  // NEW route that doesn't read the catalogue needs an entry here too.
  if (
    pathname?.startsWith("/admin") ||
    pathname?.startsWith("/user") ||
    pathname?.startsWith("/register")
  ) {
    return null;
  }

  if (!visible || !mounted) return null;

  return createPortal(
    <div className={`loading-screen ${loading ? "" : "loading-screen-hide"}`}>
      <Image
        src="/FoneFix-Logo.png"
        alt="FoneFix Killarney"
        width={340}
        height={54}
        priority
        className="loading-logo"
      />
      <div className="loading-spinner" />
      <p className="loading-text">Loading products…</p>
    </div>,
    document.body,
  );
}
