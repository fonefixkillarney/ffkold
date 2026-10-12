'use client';

import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { WishlistProvider } from '@/context/WishlistContext';
import { SidebarProvider } from '@/context/SidebarContext';
import { DataProvider } from '@/context/DataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Toaster } from 'react-hot-toast';
import LoadingScreen from '@/app/components/ui/LoadingScreen';
import PromoBalloon from '@/app/components/ui/PromoBalloon';
import PromoPosters from '@/app/components/home/PromoPosters';

function ViewportToaster() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: { fontSize: '13px', borderRadius: '6px' },
        success: { iconTheme: { primary: '#80E4FE', secondary: '#000' } },
        duration: 2500,
      }}
    />,
    document.body,
  );
}

export default function Providers({ children }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DataProvider>
          <CartProvider>
            <WishlistProvider>
              <SidebarProvider>
                {children}
                <LoadingScreen />
                {/* Portals itself to <body>, so living inside the app shell's
                    entrance transform here is fine. Waits for the opening
                    animation to finish before showing anything. */}
                <PromoPosters />
                <PromoBalloon />
                <ViewportToaster />
              </SidebarProvider>
            </WishlistProvider>
          </CartProvider>
        </DataProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
