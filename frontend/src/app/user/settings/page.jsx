"use client";

import { MailCheck, RotateCcw, Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";

// Matches CODE_LENGTH in be-eominio/utils/verification.js.
const CODE_LENGTH = 4;
// Matches MAX_NAME_LENGTH in be-eominio/controllers/userController.js.
const MAX_NAME_LENGTH = 80;

// A missing preference means its default (order updates on, sale alerts off).
const formFromUser = (user) => ({
  name: user?.name ?? "",
  email: user?.email ?? "",
  orderUpdates: user?.orderUpdates !== false,
  saleAlerts: user?.saleAlerts === true,
});

export default function UserSettingsPage() {
  const {
    user,
    userLoading,
    updateProfile,
    requestEmailChange,
    confirmEmailChange,
  } = useAuth();
  const [form, setForm] = useState(() => formFromUser(null));
  const [saving, setSaving] = useState(false);

  // The address a confirmation code is out for (null = no change pending). The
  // account keeps its current email until that code comes back.
  const [pendingEmail, setPendingEmail] = useState(null);
  const [code, setCode] = useState("");
  // Only set when the backend has no mail transport configured and isn't in
  // production — it returns the code so the flow stays testable.
  const [devCode, setDevCode] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const codeInput = useRef(null);

  // Seeded once, when the account arrives. Re-seeding on every `user` change
  // would snap the email box back to the old address as soon as the name half
  // of a save lands, while the new address's code is still out.
  const seeded = useRef(false);
  useEffect(() => {
    if (!user || seeded.current) return;
    seeded.current = true;
    setForm(formFromUser(user));
  }, [user]);

  useEffect(() => {
    if (pendingEmail) codeInput.current?.focus();
  }, [pendingEmail]);

  const saved = formFromUser(user);
  const name = form.name.trim();
  const email = form.email.trim().toLowerCase();

  const profileChanges = {};
  if (name !== saved.name) profileChanges.name = name;
  if (form.orderUpdates !== saved.orderUpdates)
    profileChanges.orderUpdates = form.orderUpdates;
  if (form.saleAlerts !== saved.saleAlerts)
    profileChanges.saleAlerts = form.saleAlerts;
  const profileDirty = Object.keys(profileChanges).length > 0;
  // A new address the code isn't already out for — re-saving the pending one
  // would only be a resend, which has its own button.
  const emailDirty = email !== saved.email && email !== pendingEmail;

  const setField = (field) => (event) => {
    const { type, checked, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [field]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSave = async (event) => {
    // Without this the browser would submit the form itself and reload the page.
    event.preventDefault();
    if (!profileDirty && !emailDirty) return;
    setSaving(true);
    try {
      if (profileDirty) {
        await updateProfile(profileChanges);
        toast.success("Settings saved");
      }
      if (emailDirty) {
        const result = await requestEmailChange(email);
        setPendingEmail(result.email || email);
        setDevCode(result.devCode || null);
        setCode("");
        toast.success(
          `We emailed a ${CODE_LENGTH}-digit code to ${result.email || email}`,
        );
      }
    } catch (error) {
      toast.error(error.message || "Could not save your settings");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async (event) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH || confirming) return;
    setConfirming(true);
    try {
      const account = await confirmEmailChange(code);
      setForm((prev) => ({ ...prev, email: account.email }));
      setPendingEmail(null);
      setDevCode(null);
      setCode("");
      toast.success("Email updated");
    } catch (error) {
      setCode("");
      codeInput.current?.focus();
      toast.error(error.message || "Could not verify that code");
    } finally {
      setConfirming(false);
    }
  };

  const handleResend = async () => {
    try {
      const result = await requestEmailChange(pendingEmail);
      setDevCode(result.devCode || null);
      setCode("");
      codeInput.current?.focus();
      toast.success("A new code is on its way");
    } catch (error) {
      toast.error(error.message || "Could not resend the code");
    }
  };

  // Only drops it on this side: the code on the server can't be used without
  // being typed in here, and it expires on its own in 10 minutes.
  const cancelEmailChange = () => {
    setPendingEmail(null);
    setDevCode(null);
    setCode("");
    setForm((prev) => ({ ...prev, email: saved.email }));
  };

  const header = (
    <div className="mb-4 flex items-center gap-3">
      <span className="panel-chip">
        <Settings size={18} />
      </span>
      <h2 className="panel-title">Settings</h2>
    </div>
  );

  if (userLoading) {
    return (
      <section className="panel p-5">
        {header}
        <p className="panel-muted text-sm">Loading your settings…</p>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="panel p-5">
        {header}
        <p className="panel-muted text-sm">
          Sign in to edit your account settings.
        </p>
        <Link
          href="/register?mode=login&next=/user/settings"
          className="btn-primary mt-4"
        >
          Sign in
        </Link>
      </section>
    );
  }

  return (
    <>
      <form onSubmit={handleSave} className="panel p-5">
        {header}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="user-name"
              className="panel-strong mb-1 block text-sm font-medium"
            >
              Name
            </label>
            <input
              id="user-name"
              className="input-field"
              placeholder="Your name"
              autoComplete="name"
              required
              maxLength={MAX_NAME_LENGTH}
              value={form.name}
              onChange={setField("name")}
            />
          </div>
          <div>
            <label
              htmlFor="user-email"
              className="panel-strong mb-1 block text-sm font-medium"
            >
              Email
            </label>
            <input
              id="user-email"
              type="email"
              className="input-field"
              placeholder="you@example.com"
              autoComplete="email"
              required
              value={form.email}
              onChange={setField("email")}
            />
            {emailDirty && (
              <p className="panel-muted mt-1 text-xs">
                We&apos;ll email a code to the new address to confirm it. Your
                account keeps using {saved.email} until then.
              </p>
            )}
          </div>

          <label className="panel-muted flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={form.orderUpdates}
              onChange={setField("orderUpdates")}
            />
            Send order status updates
          </label>
          <label className="panel-muted flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={form.saleAlerts}
              onChange={setField("saleAlerts")}
            />
            Receive sale and restock alerts
          </label>
        </div>
        <div className="flex justify-end pt-3">
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || (!profileDirty && !emailDirty)}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      {pendingEmail && (
        <section className="panel p-5">
          <div className="mb-4 flex items-start gap-3">
            <span className="panel-chip">
              <MailCheck size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="panel-title">Confirm your new email</h2>
              <p className="panel-sub">
                Enter the {CODE_LENGTH}-digit code we sent to{" "}
                <strong className="panel-strong break-all">
                  {pendingEmail}
                </strong>
                . It expires in 10 minutes.
              </p>
            </div>
          </div>

          {devCode && (
            <div className="mb-4 rounded-lg border border-amber-400/60 bg-amber-400/15 p-3 text-xs text-amber-800 dark:text-amber-200">
              Email sending isn&apos;t configured on the server yet, so here is
              the code: <strong className="font-mono text-sm">{devCode}</strong>
            </div>
          )}

          <form
            onSubmit={handleConfirm}
            className="flex flex-wrap items-center gap-3"
          >
            <input
              ref={codeInput}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(event) =>
                setCode(
                  event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH),
                )
              }
              aria-label="Confirmation code"
              placeholder="0000"
              className="input-field max-w-40 text-center font-mono text-lg tracking-[0.5em]"
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={confirming || code.length < CODE_LENGTH}
            >
              {confirming ? "Confirming…" : "Confirm"}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <button
              type="button"
              onClick={handleResend}
              disabled={confirming}
              className="panel-strong inline-flex items-center gap-2 font-semibold underline"
            >
              <RotateCcw size={14} />
              Send a new code
            </button>
            <button
              type="button"
              onClick={cancelEmailChange}
              className="panel-muted underline"
            >
              Keep my current email
            </button>
          </div>
        </section>
      )}
    </>
  );
}
