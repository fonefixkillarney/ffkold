"use client";

import { KeyRound, MailCheck, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import PasswordField from "@/app/components/ui/PasswordField";
import { useAuth } from "@/context/AuthContext";

// Only same-site paths are safe redirect targets — anything absolute
// (https://…, //evil.com) coming from the ?next= param is discarded.
function safeNext(next) {
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/";
}

// Matches CODE_LENGTH in be-eominio/utils/verification.js.
const CODE_LENGTH = 4;
const EMPTY_CODE = Array(CODE_LENGTH).fill("");
// Matches MIN_PASSWORD_LENGTH in be-eominio/utils/verification.js, which now
// enforces it server-side too.
const MIN_PASSWORD = 6;

function ForgotPasswordForm() {
  const { forgotPassword, resetPassword } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));

  // "email" asks where to send the code, "reset" takes the code + new password.
  // Unlike login there is no separate verify step: the code and the new password
  // are submitted together, so a correct code is never left sitting around
  // usable on its own.
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [pendingEmail, setPendingEmail] = useState("");
  const [digits, setDigits] = useState(EMPTY_CODE);
  // Only set when the backend has no mail transport configured and isn't in
  // production — it hands the code back so the flow stays testable.
  const [devCode, setDevCode] = useState(null);
  const codeInputs = useRef([]);

  const code = digits.join("");

  useEffect(() => {
    if (step === "reset") codeInputs.current[0]?.focus();
  }, [step]);

  // Step 1 — ask for the code. This deliberately reports success even for an
  // address with no account: the backend answers identically either way so the
  // endpoint can't be used to discover which emails are registered, and echoing
  // a "no such account" here would give that away again.
  const handleRequest = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const typed = email.trim();
      const result = await forgotPassword(typed);
      setPendingEmail(result.email || typed);
      setDevCode(result.devCode || null);
      setDigits(EMPTY_CODE);
      setStep("reset");
      toast.success("If that email has an account, a code is on its way");
    } catch (error) {
      toast.error(error.message || "Could not send a reset code");
    } finally {
      setSubmitting(false);
    }
  };

  // Step 2 — code + new password in one request, which is also what signs in.
  const handleReset = async (event) => {
    event.preventDefault();
    if (password !== confirm) {
      toast.error("Those passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(pendingEmail, code, password);
      toast.success("Password updated — you're signed in");
      router.replace(next);
    } catch (error) {
      // Keep the typed password; it's the code that's usually wrong.
      setDigits(EMPTY_CODE);
      codeInputs.current[0]?.focus();
      toast.error(error.message || "Could not reset your password");
    } finally {
      setSubmitting(false);
    }
  };

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
    setDigits((prev) => {
      const filled = [...prev];
      for (let i = 0; i < typed.length && index + i < CODE_LENGTH; i += 1) {
        filled[index + i] = typed[i];
      }
      return filled;
    });
    codeInputs.current[
      Math.min(index + typed.length, CODE_LENGTH - 1)
    ]?.focus();
  };

  const onDigitKeyDown = (index) => (event) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      codeInputs.current[index - 1]?.focus();
    }
  };

  const handleResend = async () => {
    try {
      const result = await forgotPassword(pendingEmail);
      setDevCode(result.devCode || null);
      setDigits(EMPTY_CODE);
      codeInputs.current[0]?.focus();
      toast.success("A new code is on its way");
    } catch (error) {
      toast.error(error.message || "Could not resend the code");
    }
  };

  const startOver = () => {
    setStep("email");
    setDigits(EMPTY_CODE);
    setDevCode(null);
    setPendingEmail("");
    setPassword("");
    setConfirm("");
  };

  const canSubmitReset =
    code.length === CODE_LENGTH &&
    password.length >= MIN_PASSWORD &&
    confirm.length > 0;

  // ── Step 2: the emailed code + the new password ──
  if (step === "reset") {
    return (
      <div className="flex w-full justify-center px-4 py-10">
        <div className="glass-panel w-full max-w-sm p-6">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <div className="glass-chip-lg">
              <MailCheck size={30} />
            </div>
            <h1 className="glass-strong text-xl font-semibold">Choose a new password</h1>
            <p className="glass-muted text-sm">
              If <strong className="glass-strong">{pendingEmail}</strong> has an
              account, we sent it a {CODE_LENGTH}-digit code. It expires in 10
              minutes.
            </p>
          </div>

          {devCode && (
            <div className="mb-4 rounded-lg border border-amber-400/60 bg-amber-400/15 p-3 text-xs text-amber-800 dark:text-amber-200">
              Email sending isn&apos;t configured on the server yet, so here is
              the code: <strong className="font-mono text-sm">{devCode}</strong>
            </div>
          )}

          <form onSubmit={handleReset} className="space-y-4">
            <fieldset className="flex justify-center gap-3">
              <legend className="sr-only">Reset code</legend>
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

            <PasswordField
              id="reset-password"
              label="New password"
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="glass-input"
              autoComplete="new-password"
            />
            <PasswordField
              id="reset-password-confirm"
              label="Confirm new password"
              required
              minLength={MIN_PASSWORD}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="glass-input"
              autoComplete="new-password"
            />
            {confirm.length > 0 && password !== confirm && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">
                Those passwords don&apos;t match.
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !canSubmitReset}
              className="glass-btn-primary w-full"
            >
              {submitting ? "Updating…" : "Update password"}
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
              onClick={startOver}
              className="glass-muted underline"
            >
              Use a different email
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 1: which address ──
  return (
    <div className="flex w-full justify-center px-4 py-10">
      <div className="glass-panel w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="glass-chip-lg">
            <KeyRound size={30} />
          </div>
          <h1 className="glass-strong text-xl font-semibold">Forgot your password?</h1>
          <p className="glass-muted text-sm">
            Enter your email and we&apos;ll send you a {CODE_LENGTH}-digit code
            to set a new one.
          </p>
        </div>

        <form onSubmit={handleRequest} className="space-y-4">
          <div>
            <label
              htmlFor="forgot-email"
              className="glass-strong mb-1 block text-sm font-medium"
            >
              Email
            </label>
            <input
              id="forgot-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="glass-input"
              autoComplete="username"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="glass-btn-primary w-full"
          >
            {submitting ? "Sending…" : "Send reset code"}
          </button>
        </form>

        <p className="glass-faint mt-4 flex items-center justify-center gap-1.5 text-center text-xs">
          <ShieldCheck size={13} />
          Your current password keeps working until you set a new one.
        </p>

        <p className="glass-muted mt-4 text-center text-sm">
          Remembered it?{" "}
          <Link
            href={`/register?mode=login&next=${encodeURIComponent(next)}`}
            className="glass-strong font-semibold underline"
          >
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
