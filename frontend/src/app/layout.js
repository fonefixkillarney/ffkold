import { Inter } from 'next/font/google';
import { Suspense } from 'react';
import './globals.css';
import Providers from '@/app/components/Providers';
import IntroAnimation from '@/app/components/ui/IntroAnimation';
import Header from '@/app/components/layout/Header';
import NavHistoryTracker from '@/app/components/layout/NavHistoryTracker';
import Footer from '@/app/components/footer';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata = {
  title: 'TechStore — Mobile Accessories & Gadgets',
  description:
    'Shop the latest mobile accessories, gadgets, cables, power banks, smart watches and more at unbeatable prices.',
};


const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('techstore-theme');
    var dark = stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-white dark:bg-black antialiased">
        {/* Outside the shell below on purpose: that wrapper's `animate-page-enter`
            transform would become the containing block for the intro's
            `position: fixed`, pinning a full-screen overlay to the top of the
            document instead of the viewport.

            `overflow-x-clip` stops the decorative glows (`.panel-shell::before`,
            `.glass-shell::before`), which bleed past their containers on purpose,
            from widening the page: on a phone that made /admin 451px wide on a
            375px screen and the browser zoomed the whole panel out. `clip`, not
            `hidden` — hidden would make this a scroll container and silently
            break every `position: sticky` inside it. */}
        <IntroAnimation />
        <div className="flex min-h-screen flex-col overflow-x-clip animate-page-enter">
          <Providers>
            <Header />
            <main className="flex-1">
              {children}
            </main>
            <Footer />

            <Suspense fallback={null}>
              <NavHistoryTracker />
            </Suspense>
          </Providers>
        </div>
      </body>
    </html>
  );
}
