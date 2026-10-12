"use client";

import {
  Home,
  LogOut,
  Menu,
  Moon,
  PackageCheck,
  Settings,
  Sun,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import Drawer from "@/app/components/ui/Drawer";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";

export default function UserLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logoutUser } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [navOpen, setNavOpen] = useState(false);

  // The drawer only exists below lg. Growing past that breakpoint while it is
  // open would leave its backdrop and body-scroll lock live behind a panel that
  // `lg:hidden` has already removed, so close it as soon as desktop kicks in.
  useEffect(() => {
    if (!navOpen) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      if (desktop.matches) setNavOpen(false);
    };
    sync();
    desktop.addEventListener("change", sync);
    return () => desktop.removeEventListener("change", sync);
  }, [navOpen]);

  const handleLogout = () => {
    setNavOpen(false);
    logoutUser();
    toast.success("Signed out");
    router.push("/");
  };

  const navItems = [
    { href: "/", label: "Home", icon: Home },
    { href: "/user", label: "Product History", icon: PackageCheck },
    { href: "/user/settings", label: "Settings", icon: Settings },
  ];

  // Rendered twice — in the desktop sidebar and inside the mobile drawer — from
  // this single source, so the two can never drift apart. Both hosts are flex
  // columns, which is what lets `mt-auto` pin Log out to the bottom in each.
  //
  // The active row is `.panel-nav-active`: a neon rail plus a faint tint. It
  // replaces the rotating `.border-beam` ring, which drew a spinning blue
  // outline around the whole button and read as a glitch rather than a state.
  const navContent = (
    <>
      <nav className="space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setNavOpen(false)}
            aria-current={pathname === href ? "page" : undefined}
            className={`panel-nav ${pathname === href ? "panel-nav-active" : ""}`}
          >
            <Icon size={16} className="shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      {/* mt-auto pins this to the bottom of the full-height sidebar. */}
      <button type="button" onClick={handleLogout} className="panel-nav-danger">
        <LogOut size={15} />
        Log out
      </button>
    </>
  );

  const themeToggle = (
    <button
      type="button"
      onClick={toggleTheme}
      className="btn-icon shrink-0"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );

  const identity = (size) => (
    <div className="flex min-w-0 items-center gap-3">
      <span className="panel-chip">
        <UserRound size={size} />
      </span>
      <div className="min-w-0">
        <h1 className="panel-title truncate">User Panel</h1>
        <p className="panel-sub truncate">{user?.email || "Customer account"}</p>
      </div>
    </div>
  );

  return (
    // `glass-scope` re-points the `--panel-*` tokens to glass values for this
    // subtree, so every shared dashboard class in here (.panel, .panel-table,
    // .panel-nav, .pager-*, .input-field, .badge) renders as glass without any
    // of them being renamed — and the admin routes, which never carry the
    // class, keep the opaque look the client signed off on. `glass-shell`
    // supplies the aurora the translucent panels blur.
    <div className="glass-scope glass-shell container-main py-6">
      {/* Below lg the sidebar would collapse into a full-width card the user has
          to scroll past, so it is replaced by this bar plus the drawer. */}
      <div className="panel sticky top-0 z-30 mb-4 flex items-center gap-3 p-3 lg:hidden">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          className="btn-icon shrink-0"
          aria-label="Open user menu"
          aria-expanded={navOpen}
        >
          <Menu size={20} />
        </button>
        {identity(18)}
        <div className="ml-auto">{themeToggle}</div>
      </div>

      {/* Drawer portals into <body> too, so it sits outside the `.glass-scope`
          above and has to carry the class itself. Custom properties declared on
          an element are visible to that same element's own declarations, so
          `.panel` here still resolves against the glass tokens — only the blur,
          which is a property rather than a token, is added by hand. */}
      <Drawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        label="User panel menu"
        side="left"
        className="glass-scope panel w-64 max-w-[85vw] rounded-none border-y-0 border-l-0 p-4 backdrop-blur-xl lg:hidden"
      >
        {/* Mirrors the desktop aside's header (and the admin drawer's) so the
            open drawer still says whose panel it is. */}
        <div className="mb-4">{identity(20)}</div>
        {navContent}
      </Drawer>

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] min-h-[75vh]">
        <aside className="panel hidden h-full flex-col p-4 lg:flex">
          <div className="mb-4 flex items-start justify-between gap-2 border-b panel-divider pb-4">
            {identity(20)}
            {themeToggle}
          </div>
          {navContent}
        </aside>

        {/* min-w-0: a grid item defaults to `min-width: auto` and refuses to
            shrink below its content's min-content width. The order-history
            table is `min-w-160`, so without this it stretches this column —
            and the whole page — past the viewport on mobile rather than
            scrolling inside its own overflow-x container. Only bites below lg,
            where the `minmax(0,1fr)` track doesn't apply. */}
        <main className="min-w-0 space-y-6">{children}</main>
      </div>
    </div>
  );
}
