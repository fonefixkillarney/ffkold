"use client";

import { useEffect, useRef } from "react";

// Google Identity Services renders its own official button into a container and
// calls back with a signed ID token (`credential`), which the backend verifies
// at POST /api/user/google. Renders nothing until NEXT_PUBLIC_GOOGLE_CLIENT_ID
// is set, so the auth page looks exactly as before on an unconfigured build.
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const GSI_SRC = "https://accounts.google.com/gsi/client";

// One script tag for the whole app, however many times the button mounts.
let gsiLoading = null;
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  gsiLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => {
      gsiLoading = null;
      reject(new Error("Could not load Google sign-in"));
    };
    document.head.appendChild(script);
  });
  return gsiLoading;
}

// text: "signup_with" ("Sign up with Google") or "signin_with" ("Sign in with Google").
export default function GoogleSignInButton({ text = "signin_with", onCredential, onError }) {
  const container = useRef(null);
  // Held in refs so a parent re-render doesn't re-render Google's button.
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !container.current) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => handlers.current.onCredential?.(response.credential),
        });
        window.google.accounts.id.renderButton(container.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text,
          // Google caps the button at 400px; match the form's width under that.
          width: Math.min(400, container.current.offsetWidth || 320),
        });
      })
      .catch((error) => handlers.current.onError?.(error));
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!CLIENT_ID) return null;
  return <div ref={container} className="flex min-h-[44px] w-full justify-center" />;
}
