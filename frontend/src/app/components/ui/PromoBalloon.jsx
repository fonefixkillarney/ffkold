"use client";

import { PartyPopper, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/context/AuthContext";
import { useData } from "@/context/DataContext";
import { fetchFirstOrderPromo } from "@/lib/api";

// Red "10% OFF" balloon that rises from the bottom of the viewport once the
// initial loading overlay has finished. Clicking the balloon OR its cross
// bursts it, revealing a call-to-action in a centered overlay.
//
// Codes are now UNIQUE PER ACCOUNT (minted at signup), so there is no shared
// code to show here — the reveal invites the visitor to register, where their
// own code is displayed. Dismissed for the rest of the visit afterwards.
// Portaled to <body> so position:fixed anchors to the real viewport (the page
// wrapper's entrance animation leaves a transform behind — see Modal.jsx).
//
// stages: hidden → floating → burst (pop animation) → revealed (CTA overlay)
// → done (gone for the session)
const BURST_MS = 550;
const SHARDS = [0, 45, 90, 135, 180, 225, 270, 315];

export default function PromoBalloon() {
  const { loading } = useData();
  const { user, userLoading } = useAuth();
  const pathname = usePathname();
  const [stage, setStage] = useState("hidden");
  const [promo, setPromo] = useState(null);

  useEffect(() => {
    if (loading || stage !== "hidden") return;
    const t = setTimeout(() => setStage("floating"), 800);
    return () => clearTimeout(t);
  }, [loading, stage]);

  // Fetch the offer details up front (percentage only — no shared code).
  useEffect(() => {
    fetchFirstOrderPromo()
      .then(setPromo)
      .catch(() => {});
  }, []);

  // Escape closes the overlay, and page scroll is locked while it's up
  // (same behaviour as Modal.jsx).
  useEffect(() => {
    if (stage !== "revealed") return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setStage("done");
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [stage]);

  // Storefront-only, same as Header — the panels have their own chrome.
  if (pathname?.startsWith("/admin") || pathname?.startsWith("/user")) return null;

  // The code is single-use per account (promoUsed flips on the first order —
  // see be-eominio/controllers/orderController.js), so once it's spent there is
  // nothing left to advertise. Waiting out userLoading keeps a returning
  // customer from seeing the balloon flash before we know their status.
  if (userLoading || user?.promoUsed) return null;

  if (stage === "hidden" || stage === "done") return null;

  const percent = promo?.percent || 10;

  const pop = () => {
    if (stage !== "floating") return;
    setStage("burst");
    setTimeout(() => setStage("revealed"), BURST_MS);
  };

  return createPortal(
    <>
      {(stage === "floating" || stage === "burst") && (
        <div className="promo-balloon-wrap" data-stage={stage}>
          <button
            type="button"
            className="promo-balloon"
            onClick={pop}
            aria-label="Pop the balloon to reveal your discount offer"
          >
            <span className="promo-balloon-text">
              {percent}%
              <br />
              OFF
            </span>
          </button>
          <button
            type="button"
            className="promo-balloon-close"
            onClick={pop}
            aria-label={`Close ${percent}% off offer`}
          >
            <X size={13} />
          </button>
          {stage === "burst" &&
            SHARDS.map((angle) => (
              <span
                key={angle}
                className="balloon-shard"
                style={{ "--shard-angle": `${angle}deg` }}
              />
            ))}
        </div>
      )}

      {stage === "revealed" && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: Escape-to-close is wired via the keydown listener above
        <div
          className="promo-code-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="First order discount offer"
          onClick={() => setStage("done")}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, Escape still closes via the listener above */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only, not an interactive control itself */}
          <div
            className="promo-code-card border-beam"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="promo-code-shine" />
            <span className="promo-code-spark" style={{ top: "12%", left: "10%" }} />
            <span className="promo-code-spark" style={{ top: "20%", right: "12%", animationDelay: "0.6s" }} />
            <span className="promo-code-spark" style={{ bottom: "16%", left: "16%", animationDelay: "1.1s" }} />
            <span className="promo-code-spark" style={{ bottom: "24%", right: "8%", animationDelay: "1.6s" }} />

            <PartyPopper size={34} className="promo-code-icon" />
            <p className="promo-code-eyebrow">{percent}% off in first order</p>

            <p className="promo-code-note">
              Create an account and we&apos;ll give you your <strong>own
              unique {percent}% code</strong> — valid on your very first order
              with us.
            </p>

            <div className="promo-code-actions">
              <Link
                href="/register"
                className="btn-primary"
                onClick={() => setStage("done")}
              >
                Get my code
              </Link>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setStage("done")}
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
