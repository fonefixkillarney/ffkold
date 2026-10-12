"use client";

import { Copy, MailCheck, PartyPopper, RotateCcw, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import GoogleSignInButton from "@/app/components/ui/GoogleSignInButton";
import PasswordField from "@/app/components/ui/PasswordField";
import { useAuth } from "@/context/AuthContext";

// The Google button (and its "or" divider) only appear once a client id is set.
const GOOGLE_ENABLED = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);

// Only same-site paths are safe redirect targets — anything absolute
// (https://…, //evil.com) coming from the ?next= param is discarded.
function safeNext(next) {
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/";
}

// Matches CODE_LENGTH in be-eominio/utils/verification.js.
const CODE_LENGTH = 4;
const EMPTY_CODE = Array(CODE_LENGTH).fill("");

function RegisterForm() {
  const {
    isUser,
    userLoading,
    registerUser,
    loginUser,
    verifyCode,
    resendCode,
    googleSignIn,
  } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));

  // ?mode=login lands straight on the login form (the header's Login button);
  // anything else opens on registration.
  const [mode, setMode] = useState(
    searchParams.get("mode") === "login" ? "login" : "register",
  );
  // "credentials" = name/email/password, "code" = the emailed 4-digit step.
  const [step, setStep] = useState("credentials");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);

  // Held across the two steps: the address the code went to. The credential
  // fields themselves are wiped on submit, so this is what /user/verify is
  // called with.
  const [pendingEmail, setPendingEmail] = useState("");
  const [digits, setDigits] = useState(EMPTY_CODE);
  // Only set when the backend has no mail transport configured and isn't in
  // production — it returns the code so the flow stays testable.
  const [devCode, setDevCode] = useState(null);
  const codeInputs = useRef([]);
  // Belt-and-braces against a double verify: the auto-submit effect and the
  // explicit button can both fire for the same 4 digits.
  const verifying = useRef(false);

  // After a successful *registration* we hold the new account's unique first-order
  // code on screen (with a Continue button) instead of redirecting immediately.
  const [registeredCode, setRegisteredCode] = useState(null);

  const code = digits.join("");

  const setField = (field) => (event) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  // Already registered and verified against the DB — nothing to do here. Skip
  // this while we're showing the freshly-minted code (registeredCode set).
  useEffect(() => {
    if (!userLoading && isUser && !registeredCode) router.replace(next);
  }, [userLoading, isUser, router, next, registeredCode]);

  useEffect(() => {
    if (step === "code") codeInputs.current[0]?.focus();
  }, [step]);

  // Step 1 — password. Never returns a token; it just mails the code.
  const handleCredentials = async (event) => {
    // Without this the browser would submit the form itself, reloading the page
    // (and putting the values in the URL) instead of letting fetch handle it.
    event.preventDefault();
    setSubmitting(true);
    try {
      const typedEmail = form.email.trim();
      const result =
        mode === "register"
          ? await registerUser({
            name: form.name.trim(),
            email: typedEmail,
            password: form.password,
          })
          : await loginUser(typedEmail, form.password);

      setPendingEmail(result.email || typedEmail);
      setDevCode(result.devCode || null);
      setDigits(EMPTY_CODE);
      // Nothing typed is left sitting in the inputs once it's been submitted.
      setForm({ name: "", email: "", password: "" });
      setStep("code");
      toast.success("We emailed you a 4-digit code");
    } catch (error) {
      // Retry keeps the email but never the password.
      setForm((prev) => ({ ...prev, password: "" }));
      toast.error(error.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  // Step 2 — the code, which is what issues the token.
  const submitCode = async (value) => {
    if (verifying.current) return;
    verifying.current = true;
    setSubmitting(true);
    try {
      const account = await verifyCode(pendingEmail, value);
      if (mode === "register" && account?.promoCode) {
        // Show the unique code before continuing to checkout.
        setRegisteredCode({
          code: account.promoCode,
          percent: account.promoPercent || 10,
        });
        toast.success("Email confirmed — here's your first-order code!");
        return;
      }
      toast.success(mode === "register" ? "Account created — welcome!" : "Welcome back!");
      router.replace(next);
    } catch (error) {
      setDigits(EMPTY_CODE);
      codeInputs.current[0]?.focus();
      toast.error(error.message || "Could not verify that code");
    } finally {
      verifying.current = false;
      setSubmitting(false);
    }
  };

  // Google: one step, no emailed code. A brand-new account still gets the same
  // first-order code reveal as a regular registration.
  const handleGoogle = async (credential) => {
    setSubmitting(true);
    try {
      const { account, created } = await googleSignIn(credential);
      if (created && account?.promoCode) {
        setRegisteredCode({
          code: account.promoCode,
          percent: account.promoPercent || 10,
        });
        toast.success("Account created — here's your first-order code!");
        return;
      }
      toast.success("Welcome back!");
      router.replace(next);
    } catch (error) {
      toast.error(error.message || "Google sign-in failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Verify as soon as the last box is filled — the explicit button below stays
  // for keyboard/screen-reader users.
  // biome-ignore lint/correctness/useExhaustiveDependencies: submitCode is redefined every render; the ref above is what guards re-entry
  useEffect(() => {
    if (step === "code" && code.length === CODE_LENGTH) submitCode(code);
  }, [code, step]);

  const setDigit = (index) => (event) => {
    const raw = event.target.value.replace(/\D/g, "");
    // Typing into a box that already holds a digit appends to it, so drop the
    // old digit and keep only what was just entered. Pasting the whole code
    // lands here too and is spread across the boxes below.
    const typed =
      digits[index] && raw.length > 1 && raw.startsWith(digits[index])
        ? raw.slice(digits[index].length)
        : raw;
    if (!typed) {
      setDigits((prev) => prev.map((digit, i) => (i === index ? "" : digit)));
      return;
    }
    // A pasted code (or a fast typist) fills every box from this one on.
    setDigits((prev) => {
      const filled = [...prev];
      for (let i = 0; i < typed.length && index + i < CODE_LENGTH; i += 1) {
        filled[index + i] = typed[i];
      }
      return filled;
    });
    codeInputs.current[Math.min(index + typed.length, CODE_LENGTH - 1)]?.focus();
  };

  const onDigitKeyDown = (index) => (event) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      codeInputs.current[index - 1]?.focus();
    }
  };

  const handleResend = async () => {
    try {
      const result = await resendCode(pendingEmail);
      setDevCode(result.devCode || null);
      setDigits(EMPTY_CODE);
      codeInputs.current[0]?.focus();
      toast.success("A new code is on its way");
    } catch (error) {
      toast.error(error.message || "Could not resend the code");
    }
  };

  const backToCredentials = () => {
    setStep("credentials");
    setDigits(EMPTY_CODE);
    setDevCode(null);
    setPendingEmail("");
  };

  const copyCode = async () => {
    if (!registeredCode) return;
    try {
      await navigator.clipboard.writeText(registeredCode.code);
      toast.success("Code copied!");
    } catch {
      toast(`Your code: ${registeredCode.code}`);
    }
  };

  const continueAfterRegister = () => {
    setRegisteredCode(null);
    router.replace(next);
  };

  // ── Unique-code reveal (post-registration) ──
  if (registeredCode) {
    const continuesToCheckout = next.startsWith("/checkout");
    return (
      <div className="flex w-full justify-center px-4 py-10">
        <div className="glass-panel w-full max-w-sm p-6 text-center">
          <div className="glass-chip-lg mx-auto mb-4">
            <PartyPopper size={30} />
          </div>
          <h1 className="glass-strong text-xl font-semibold">You&apos;re in!</h1>
          <p className="glass-muted mt-1 text-sm">
            Here&apos;s your personal code for {registeredCode.percent}% off your
            first order.
          </p>

          <div className="glass-inset my-5 border-2 border-dashed px-4 py-4">
            <span className="glass-strong block font-mono text-2xl font-bold tracking-widest">
              {registeredCode.code}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="glass-btn w-full"
              onClick={copyCode}
            >
              <Copy size={15} />
              Copy code
            </button>
            <button
              type="button"
              className="glass-btn-primary w-full"
              onClick={continueAfterRegister}
            >
              {continuesToCheckout ? "Continue to checkout" : "Start shopping"}
            </button>
          </div>
          <p className="glass-faint mt-3 text-xs">
            It&apos;s already filled in at checkout — valid once, on your first
            order only.
          </p>
        </div>
      </div>
    );
  }

  // ── Step 2: the emailed 4-digit code ──
  if (step === "code") {
    return (
      <div className="flex w-full justify-center px-4 py-10">
        <div className="glass-panel w-full max-w-sm p-6">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <div className="glass-chip-lg">
              <MailCheck size={30} />
            </div>
            <h1 className="glass-strong text-xl font-semibold">Check your email</h1>
            <p className="glass-muted text-sm">
              We sent a {CODE_LENGTH}-digit code to{" "}
              <strong className="glass-strong">{pendingEmail}</strong>. It expires in
              10 minutes.
            </p>
          </div>

          {devCode && (
            <div className="mb-4 rounded-lg border border-amber-400/60 bg-amber-400/15 p-3 text-xs text-amber-800 dark:text-amber-200">
              Email sending isn&apos;t configured on the server yet, so here is the
              code: <strong className="font-mono text-sm">{devCode}</strong>
            </div>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (code.length === CODE_LENGTH) submitCode(code);
            }}
            className="space-y-4"
          >
            {/* Not disabled while verifying on purpose: the boxes have to stay
                focusable so a rejected code can put the cursor back on box 1.
                Re-entry is guarded by the `verifying` ref instead. */}
            <fieldset className="flex justify-center gap-3">
              <legend className="sr-only">Verification code</legend>
              {digits.map((digit, index) => (
                <input
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional inputs
                  key={index}
                  ref={(element) => {
                    codeInputs.current[index] = element;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  maxLength={CODE_LENGTH}
                  value={digit}
                  onChange={setDigit(index)}
                  onKeyDown={onDigitKeyDown(index)}
                  aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
                  className="glass-code"
                />
              ))}
            </fieldset>

            <button
              type="submit"
              disabled={submitting || code.length < CODE_LENGTH}
              className="glass-btn-primary w-full"
            >
              {submitting ? "Verifying…" : "Verify"}
            </button>
          </form>

          <div className="mt-4 flex flex-col gap-2 text-center text-sm">
            <button
              type="button"
              onClick={handleResend}
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 glass-strong font-semibold underline"
            >
              <RotateCcw size={14} />
              Send a new code
            </button>
            <button
              type="button"
              onClick={backToCredentials}
              className="glass-muted underline"
            >
              Use a different email
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 1: credentials ──
  return (
    <div className="flex w-full justify-center px-4 py-10">
      <div className="glass-panel w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="glass-chip-lg">
            <UserRoundPlus size={30} />
          </div>
          <h1 className="glass-strong text-xl font-semibold">
            {mode === "register" ? "Create your account" : "Log in"}
          </h1>
          <p className="glass-muted text-sm">
            {mode === "register"
              ? "Register to unlock your unique 10% first-order code."
              : next.startsWith("/checkout")
                ? "Log in to continue to checkout."
                : "Log in to your account."}
          </p>
        </div>

        {GOOGLE_ENABLED && (
          <>
            <GoogleSignInButton
              key={mode}
              text={mode === "register" ? "signup_with" : "signin_with"}
              onCredential={handleGoogle}
              onError={(error) => toast.error(error.message)}
            />
            <div className="glass-faint my-4 flex items-center gap-3 text-xs uppercase tracking-wider">
              <span className="h-px flex-1 bg-current opacity-30" />
              or
              <span className="h-px flex-1 bg-current opacity-30" />
            </div>
          </>
        )}

        <form onSubmit={handleCredentials} className="space-y-4">
          {mode === "register" && (
            <div>
              <label
                htmlFor="register-name"
                className="glass-strong mb-1 block text-sm font-medium"
              >
                Full name
              </label>
              <input
                id="register-name"
                required
                value={form.name}
                onChange={setField("name")}
                className="glass-input"
                autoComplete="name"
              />
            </div>
          )}
          <div>
            <label
              htmlFor="register-email"
              className="glass-strong mb-1 block text-sm font-medium"
            >
              Email
            </label>
            <input
              id="register-email"
              type="email"
              required
              value={form.email}
              onChange={setField("email")}
              className="glass-input"
              autoComplete="username"
            />
          </div>
          <PasswordField
            id="register-password"
            required
            minLength={6}
            value={form.password}
            onChange={setField("password")}
            className="glass-input"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
          />
          {/* Only on the login side: someone registering has no password to
              forget yet. The email already typed is carried over so the reset
              screen doesn't ask for it twice, and ?next= survives the detour so
              a checkout redirect still lands where it was going. */}
          {mode === "login" && (
            <p className="-mt-2 text-right text-sm">
              <Link
                href={`/forgot-password?next=${encodeURIComponent(next)}${form.email.trim() ? `&email=${encodeURIComponent(form.email.trim())}` : ""}`}
                className="glass-strong font-semibold underline"
              >
                Forgot password?
              </Link>
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="glass-btn-primary w-full"
          >
            {submitting
              ? mode === "register"
                ? "Creating account…"
                : "Checking…"
              : mode === "register"
                ? "Create account"
                : "Log in"}
          </button>
        </form>

        <p className="glass-muted mt-4 text-center text-sm">
          {mode === "register" ? "Already have an account?" : "New here?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "register" ? "login" : "register");
              setForm({ name: "", email: "", password: "" });
            }}
            className="glass-strong font-semibold underline"
          >
            {mode === "register" ? "Log in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}
