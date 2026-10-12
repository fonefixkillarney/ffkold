"use client";

import {
  ClipboardList,
  Home,
  LogOut,
  Menu,
  Moon,
  PackagePlus,
  Settings,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Drawer from "@/app/components/ui/Drawer";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/admin", label: "Orders Management", icon: ClipboardList },
  {
    href: "/admin/upcoming-products",
    label: "Upcoming Products",
    icon: PackagePlus,
  },
  // { href: "/admin/settings", label: "Settings", icon: Settings },
];

// The active row is `.panel-nav-active`: a neon rail plus a faint tint. It
// replaces the rotating `.border-beam` ring, which drew a spinning blue outline
// around the whole button and read as a glitch rather than a state.
function AdminNav({ pathname, onNavigate, onLogout }) {
  return (
    <>
      <nav className="space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={pathname === href ? "page" : undefined}
            className={`panel-nav ${pathname === href ? "panel-nav-active" : ""}`}
          >
            <Icon size={16} className="shrink-0" />
            {label}
          </Link>
        ))}
      </nav>
      <button type="button" onClick={onLogout} className="panel-nav-danger">
        <LogOut size={15} />
        Log out
      </button>
    </>
  );
}

export default function AdminDashboardLayout({ children }) {
  const { isAdmin, loading, admin, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/admin/login");
  }, [loading, isAdmin, router]);


  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (mq.matches) setNavOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (loading || !isAdmin) {
    return (
      <div className="container-main panel-muted py-20 text-center">
        Checking access…
      </div>
    );
  }

  const handleLogout = () => {
    logout();
    router.replace("/admin/login");
  };


  const themeToggle = (
    <button
      type="button"
      onClick={toggleTheme}
      className="btn-icon cursor-pointer shrink-0"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );

  return (
    <div className="panel-shell container-main py-6">

      <div className="panel sticky top-0 z-30 -mx-4 mb-4 flex items-center gap-3 rounded-none border-x-0 border-t-0 px-4 py-2 lg:hidden">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          className="btn-icon cursor-pointer shrink-0"
          aria-label="Open admin menu"
          aria-expanded={navOpen}
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="panel-title">Admin Panel</h1>
          <p className="panel-sub truncate">{admin?.email}</p>
        </div>
        {themeToggle}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="panel scroller hidden flex-col overflow-y-auto p-4 lg:flex lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          <div className="mb-4 flex items-start justify-between gap-2 border-b panel-divider pb-4">
            <div className="min-w-0">
              <h1 className="panel-title">Admin Panel</h1>
              <p className="panel-sub truncate">{admin?.email}</p>
            </div>
            {themeToggle}
          </div>
          <AdminNav pathname={pathname} onLogout={handleLogout} />
        </aside>

        <main className="min-w-0 min-h-[75vh] space-y-6">{children}</main>
      </div>

      <Drawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        label="Admin menu"
        side="left"
        className="panel w-64 max-w-[85vw] overflow-y-auto rounded-none border-y-0 border-l-0 p-4"
      >
        <div className="mb-4 min-w-0">
          <p className="panel-title">Admin Panel</p>
          <p className="panel-sub truncate">{admin?.email}</p>
        </div>
        <AdminNav
          pathname={pathname}
          onNavigate={() => setNavOpen(false)}
          onLogout={handleLogout}
        />
      </Drawer>
    </div>
  );
}
