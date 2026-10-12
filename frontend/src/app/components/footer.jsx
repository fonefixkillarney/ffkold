"use client";

import { Globe, Mail, MapPin, MessageCircle, Phone, Send } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const QUICK_LINKS = [
  { href: "/", label: "Home" },
  { href: "/category/all", label: "Shop" },
  { href: "/cart", label: "Cart" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/checkout", label: "Checkout" },
];

const SUPPORT_LINKS = [
  { href: "/user", label: "My Account" },
  { href: "/admin/login", label: "Admin Login" },
];

// Auth routes (AuthLayout) fill the viewport with the form/slideshow split,
// so the footer is suppressed there the same way Header suppresses itself.
const AUTH_ROUTES = ["/register", "/admin/login"];

export default function Footer() {
  const pathname = usePathname();

  if (AUTH_ROUTES.some((route) => pathname?.startsWith(route))) {
    return null;
  }

  return (
    <footer className="mt-10 bg-black text-gray-300">
      <div className="container-main grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Link href={'/'}>
            <Image
              src="/FoneFix-Logo.png"
              alt="TechStore Logo"
              width={3627}
              height={631}
              sizes="(min-width: 640px) 240px, 200px"
              className="h-auto w-50 max-w-full sm:w-60"
            />
          </Link>
          <p className="text-sm mt-4 leading-relaxed text-gray-400">
            Mobile accessories, gadgets and gear at unbeatable prices cables, cases,
            power banks, smart watches and more.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              aria-label="Website"
              className="flex h-8 w-8 items-center justify-center rounded-full text-white border hover:bg-primary hover:text-black transition-colors duration-200 cursor-pointer"
            >
              <Globe size={15} />
            </button>
            <button
              type="button"
              aria-label="Live chat"
              className="flex h-8 w-8 items-center justify-center rounded-full text-white border hover:bg-primary hover:text-black transition-colors duration-200 cursor-pointer"
            >
              <MessageCircle size={15} />
            </button>
            <button
              type="button"
              aria-label="Send message"
              className="flex h-8 w-8 items-center justify-center rounded-full text-white border hover:bg-primary hover:text-black transition-colors duration-200 cursor-pointer"
            >
              <Send size={15} />
            </button>
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-bold uppercase tracking-wide text-primary!">Quick Links</h4>
          <ul className="space-y-2 text-sm">
            {QUICK_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-gray-400 hover:text-primary">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* <div>
          <h4 className="mb-3 text-sm font-bold uppercase tracking-wide dark:text-white text-black">Account</h4>
          <ul className="space-y-2 text-sm">
            {SUPPORT_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-gray-400 hover:text-primary">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div> */}

        <div>
          <h4 className="mb-3 text-sm font-bold uppercase tracking-wide text-primary!">Get in Touch</h4>
          <ul className="space-y-3 text-sm text-gray-400">
            <li className="flex items-start gap-2">
              <MapPin size={15} className="mt-0.5 shrink-0 dark:text-primary" />
              <span>Killarney, Co. Kerry, Ireland</span>
            </li>
            {/* <li className="flex items-center gap-2">
              <Phone size={15} className="shrink-0 dark:text-primary" />
              <span>+353 64 661 7614</span>
            </li> */}
            <li className="flex items-center gap-2">
              <Mail size={15} className="shrink-0 dark:text-primary" />
              <span>ffktechireland@gmail.com</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="flex items-center justify-center text-sm py-4">
          <p className="text-primary!">© {new Date().getFullYear()} FFK Tech. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
