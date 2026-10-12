"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { recordNavigation } from "@/lib/navHistory";

// Renders nothing: it exists to watch route changes for lib/navHistory.js, which
// is what lets the product page's Back button return to the page the shopper
// actually came from. The App Router has no navigation events, so this is the
// documented substitute — usePathname + useSearchParams in a client component
// mounted once in the root layout.
export default function NavHistoryTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  // A back/forward step changes the URL exactly like a click does, so the only
  // way to tell them apart is to catch the popstate that precedes it.
  const popped = useRef(false);
  useEffect(() => {
    const onPopState = () => {
      popped.current = true;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const current = useRef(null);
  useEffect(() => {
    const url = search ? `${pathname}?${search}` : pathname;
    if (current.current === url) return;
    const from = current.current;
    current.current = url;
    // First run of this tab: whatever page is on screen is the tab's entry point,
    // not a navigation. A reload lands here too — and deliberately leaves the
    // stored depth alone, since reloading doesn't drop the history behind it.
    if (from === null) return;
    recordNavigation({ from, popped: popped.current });
    popped.current = false;
  }, [pathname, search]);

  return null;
}
