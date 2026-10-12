"use client";

import { Moon, ShieldCheck, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import PasswordField from "@/app/components/ui/PasswordField";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";

export default function AdminLoginPage() {
  const { login, isAdmin, loading } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && isAdmin) router.replace("/admin");
  }, [loading, isAdmin, router]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      setEmail("");
      setPassword("");
      toast.success("Welcome back, admin!");
      router.replace("/admin");
    } catch (error) {
      setPassword("");
      toast.error(error.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex w-full justify-center px-4 py-10">
      {/* Same surface tokens as the dashboard this signs you into — it used to
         be a solid neon-cyan card, which no longer matches anything behind it. */}
      <div className="panel w-full max-w-sm p-6">
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={toggleTheme}
            className="btn-icon cursor-pointer"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-15 w-15 items-center justify-center rounded-full bg-black text-primary dark:bg-[var(--neon-tint-strong)] dark:text-primary">
            <ShieldCheck size={30} />
          </div>
          <h1 className="panel-strong text-xl">Admin Login</h1>
          <p className="panel-muted text-sm">Sign in to manage the store.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="admin-email"
              className="panel-strong mb-1 block text-sm font-medium"
            >
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="input-field"
              autoComplete="username"
            />
          </div>
          <PasswordField
            id="admin-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="input-field"
            labelClassName="panel-strong mb-1 block text-sm font-medium"
            toggleClassName="panel-muted hover:text-primary-dark dark:hover:text-primary"
            autoComplete="current-password"
          />
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full cursor-pointer"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
