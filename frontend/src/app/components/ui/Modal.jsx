"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import useDismissPhase from "@/lib/useDismissPhase";

// Longest exit animation in globals.css (.modal-root[data-state="closed"]
// .modal-panel) is 180ms; the fallback that guarantees an unmount even without
// `animationend` is a little over double that. See useDismissPhase for why the
// closing phase and the fallback both have to exist.
const EXIT_FALLBACK_MS = 400;

// `variant="glass"` opts a dialog into the glassy surface used by the storefront
// and the user panel. It has to be a prop rather than inherited from an ancestor
// `.glass-scope` because this renders through createPortal into <body>, so it is
// not a descendant of the page that opened it and inherits none of its tokens.
// Admin dialogs pass nothing and keep the signed-off opaque panel.
export default function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = "max-w-lg",
  variant = "panel",
}) {
  const panelRef = useRef(null);
  const { visible, state, finishClosing } = useDismissPhase(open, EXIT_FALLBACK_MS);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Fires for the enter animation too; `finishClosing` no-ops unless we are
  // actually closing. The target check ignores animations bubbling up from the
  // dialog's own content.
  const handleExitEnd = (event) => {
    if (event.target !== panelRef.current) return;
    finishClosing();
  };

  if (!visible) return null;

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape-to-close is wired via the keydown listener above
    <div
      className={`modal-root ${variant === "glass" ? "glass-modal" : ""}`}
      data-state={state}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="modal-backdrop" />
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, Escape still closes via the listener above */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only, not an interactive control itself */}
      <div
        ref={panelRef}
        onAnimationEnd={handleExitEnd}
        className={`modal-panel scroller w-full ${maxWidth} max-h-[85vh] overflow-y-auto p-5`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b panel-divider pb-3">
          <h3 className="panel-title">{title}</h3>
          <button type="button" onClick={onClose} className="btn-icon" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
