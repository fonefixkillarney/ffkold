"use client";

import { Heart, LayoutDashboard, Menu, Moon, Search, ShoppingCart, Sun, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ProductImage from "@/app/components/ui/ProductImage";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useSidebar } from "@/context/SidebarContext";
import { useTheme } from "@/context/ThemeContext";
import { useWishlist } from "@/context/WishlistContext";
import Image from "next/image";

function CartDropdown({ cartItems, cartTotal, removeFromCart, onClose }) {
  return (
    // w-80 is what it wants, but a 320px panel hanging off the right edge of a
    // 320px phone is 32px of horizontal page scroll — the viewport caps it.
    <div className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-black! shadow-xl">
      <div className="border-b border-gray-100 dark:border-gray-800 p-3">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          Shopping Cart ({cartItems.length})
        </h4>
      </div>
      {cartItems.length === 0 ? (
        <p className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
          Your cart is empty
        </p>
      ) : (
        <>
          <ul className="max-h-60 divide-y divide-gray-50 dark:divide-gray-800 overflow-y-auto scroller">
            {cartItems.map(({ product, quantity }) => (
              <li key={product.id} className="flex items-center gap-3 p-3">
                <ProductImage
                  src={product.images[0]}
                  alt={product.name}
                  className="h-12 w-12 shrink-0 rounded border border-gray-100 dark:border-gray-800"
                  imageClassName="object-contain"
                  sizes="48px"
                  variant="thumb"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">
                    {product.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    x{quantity} <span className="text-gray-300 dark:text-gray-600">|</span>{" "}
                    <span className="font-semibold text-black dark:text-white">
                      EUR {(product.price * quantity).toFixed(2)}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFromCart(product.id)}
                  className="btn-icon cursor-pointer text-gray-400 hover:text-black"
                  aria-label={`Remove ${product.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-gray-100 dark:border-gray-800 p-3">
            <div className="mb-2 flex justify-between text-sm font-semibold text-gray-800 dark:text-gray-100">
              <span>Total</span>
              <span className="text-black dark:text-white">EUR {cartTotal.toFixed(2)}</span>
            </div>
            <Link
              href="/cart"
              onClick={onClose}
              className="btn-primary block w-full text-center"
            >
              View Cart
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { cartItems, cartCount, cartTotal, removeFromCart } = useCart();
  const { isUser, userLoading, isAdmin, loading: adminLoading } = useAuth();
  const { wishlistItems } = useWishlist();
  const { toggle } = useSidebar();
  const { isDark, toggleTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const cartRef = useRef(null);

  const handleSearch = (event) => {
    event.preventDefault();
    if (query.trim()) {
      router.push(`/category/all?search=${encodeURIComponent(query.trim())}`);
    }
  };

  useEffect(() => {
    const handler = (event) => {
      if (cartRef.current && !cartRef.current.contains(event.target)) {
        setCartOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);


  // /register is an auth route: AuthLayout renders it full-screen, so the
  // site header would sit above the split instead of framing a page.
  if (
    pathname?.startsWith("/admin") ||
    pathname?.startsWith("/user") ||
    pathname?.startsWith("/register")
  ) {
    return null;
  }


  const dashboardHref = isUser ? "/user" : isAdmin ? "/admin" : null;
  const authPending = !dashboardHref && (userLoading || adminLoading);

  return (
    // Sticky only from lg. Below it the bar wraps into three rows (logo,
    // search, buttons) plus the announcement strip — around 200px, a third of a
    // phone screen — and pinning that to the top left the shopper reading the
    // checkout through a letterbox. It scrolls away on a phone instead.
    <header className="z-40 w-full animate-slide-in-down lg:sticky lg:top-0">
      <div className="announcement-bar dark:bg-primary! font-semibold bg-gray-300! text-black">
        LOCAL BASED BUSINESS - OPEN 7 DAYS A WEEK - 24/7 CUSTOMER SUPPORT
      </div>

      <div className="border-b border-white/10 bg-black shadow-sm">
        <div className="container-main flex flex-wrap items-center gap-y-3 py-3 lg:flex-nowrap lg:justify-between lg:gap-4">
          {/* ── Mobile row 1: menu · logo · wishlist ── */}
          <div className="flex w-full items-center justify-between gap-3 lg:contents">
            <button
              type="button"
              onClick={toggle}
              className="btn-icon order-1 shrink-0 text-white lg:hidden"
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>

            <Link href="/" className="order-2 shrink-0 lg:order-2">
              {/* Intrinsic size of the file (3627×631). Passing anything else
                  makes next/image warn that the rendered aspect ratio doesn't
                  match the declared one — the display size comes from the
                  responsive height classes below, with width left auto. */}
              <Image
                className="h-9 w-auto rounded-sm sm:h-11 lg:h-14"
                width={3627}
                height={631}
                sizes="(min-width: 1024px) 340px, 240px"
                priority
                src={'/FoneFix-Logo.png'}
                alt="Logo"
              />
            </Link>


          </div>

          {/* ── Search ──
              Gets a full-width row of its own on mobile (sitting between the logo
              row and the buttons row) so it never has to share width with the
              icons, and becomes the flexible middle column from lg up. Submits to
              /category/all, whose ?search= param IS the catalogue's own filter —
              that page re-syncs its own search box from the URL, so searching
              again from up here never leaves the two showing different terms. */}
          <form
            onSubmit={handleSearch}
            className="flex w-full items-stretch lg:order-3 lg:w-auto lg:max-w-md lg:flex-1"
          >
            <label htmlFor="header-search" className="sr-only">
              Search products
            </label>
            <input
              id="header-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search products..."
              className="input-field min-w-0 flex-1 rounded-r-none"
            />
            {/* bg-primary rather than btn-primary — that one renders black-on-black
                against this header's black bar, same trap as the auth buttons. */}
            <button
              type="submit"
              className="shrink-0 cursor-pointer rounded-r bg-primary px-4 text-black transition-colors duration-200 hover:bg-white"
              aria-label="Search"
            >
              <Search size={16} />
            </button>
          </form>



          <div className="flex w-full items-center justify-between gap-3 lg:order-4 lg:w-auto lg:justify-end lg:gap-5">
            <section className="flex items-center gap-3">
              {/* Same badge treatment as the cart button below: pinned to the
                  icon's corner rather than laid out after it, which on a phone
                  was stacking under the heart and stretching this row. */}
              <Link
                href="/wishlist"
                className="relative inline-flex shrink-0 text-white"
                aria-label="Wishlist"
              >
                <Heart size={20} />
                {wishlistItems.length > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold leading-none text-black">
                    {wishlistItems.length > 9 ? "9+" : wishlistItems.length}
                  </span>
                )}
              </Link>
              <button
                type="button"
                onClick={toggleTheme}
                className="relative shrink-0 cursor-pointer text-white"
                aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              >
                {isDark ? <Sun size={20} /> : <Moon size={20} />}
              </button>
            </section>


            <div
              className={`flex items-center gap-2 ${authPending ? "invisible" : ""}`}
            >
              {dashboardHref ? (
                <Link
                  href={dashboardHref}
                  className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-black transition-colors duration-200 hover:bg-white"
                >
                  <LayoutDashboard size={14} />
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    href="/register?mode=login"
                    className="rounded border border-white/40 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-200 hover:bg-white hover:text-black"
                  >
                    Login
                  </Link>
                  <Link
                    href="/register"
                    className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-black transition-colors duration-200 hover:bg-white"
                  >
                    Register
                  </Link>
                </>
              )}
            </div>

            <div className="relative shrink-0" ref={cartRef}>
              <button
                type="button"
                onClick={() => setCartOpen((previous) => !previous)}
                className="relative cursor-pointer text-white"
                aria-label="Cart"
              >
                <ShoppingCart size={20} />
                {cartCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold leading-none text-black">
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </button>
              {cartOpen && (
                <CartDropdown
                  cartItems={cartItems}
                  cartTotal={cartTotal}
                  removeFromCart={removeFromCart}
                  onClose={() => setCartOpen(false)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
