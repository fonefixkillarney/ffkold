'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';

const WishlistContext = createContext(null);

export function WishlistProvider({ children }) {
  const [wishlistItems, setWishlistItems] = useState([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('techstore-wishlist');
      if (stored) setWishlistItems(JSON.parse(stored));
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      localStorage.setItem('techstore-wishlist', JSON.stringify(wishlistItems));
    }
  }, [wishlistItems, hydrated]);

  const addToWishlist = useCallback((product) => {
    setWishlistItems((prev) => {
      if (prev.find((p) => p.id === product.id)) return prev;
      toast.success('Added to wishlist!');
      return [...prev, product];
    });
  }, []);

  const removeFromWishlist = useCallback((productId) => {
    setWishlistItems((prev) => prev.filter((p) => p.id !== productId));
    toast('Removed from wishlist');
  }, []);

  const isWishlisted = useCallback(
    (productId) => wishlistItems.some((p) => p.id === productId),
    [wishlistItems],
  );

  const toggleWishlist = useCallback(
    (product) => {
      if (isWishlisted(product.id)) {
        removeFromWishlist(product.id);
      } else {
        addToWishlist(product);
      }
    },
    [isWishlisted, addToWishlist, removeFromWishlist],
  );

  return (
    <WishlistContext.Provider
      value={{ wishlistItems, addToWishlist, removeFromWishlist, isWishlisted, toggleWishlist }}
    >
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used within WishlistProvider');
  return ctx;
}
