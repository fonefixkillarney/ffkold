"use client";

import { ShoppingCart, X } from "lucide-react";
import Link from "next/link";
import ProductImage from "@/app/components/ui/ProductImage";
import { useCart } from "@/context/CartContext";
import { useWishlist } from "@/context/WishlistContext";

export default function WishlistPage() {
  const { wishlistItems, removeFromWishlist } = useWishlist();
  const { addToCart } = useCart();

  if (wishlistItems.length === 0) {
    return (
      <div className="glass-shell">
        <div className="container-main py-20">
          <div className="glass-panel mx-auto max-w-md p-10 text-center">
            <p className="mb-4 text-5xl">❤️</p>
            <h2 className="glass-strong mb-2 text-2xl font-bold">
              Your wishlist is empty
            </h2>
            <p className="glass-muted mb-6">
              Tap the heart on any product to save it here for later.
            </p>
            <Link href="/category/all" className="glass-btn-primary">
              Browse Products
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-shell">
      <div className="container-main py-6">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold tracking-wide text-primary-dark uppercase dark:text-primary">
              Wishlist
            </p>
            <h1 className="glass-strong">Saved Products</h1>
            <p className="glass-muted text-sm">
              {wishlistItems.length} product
              {wishlistItems.length === 1 ? "" : "s"} saved for later.
            </p>
          </div>
          <Link href="/category/all" className="glass-btn-primary w-fit">
            Continue Shopping
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {wishlistItems.map((product) => (
            <article key={product.id} className="glass-card flex-col">
              <Link
                href={`/product/${product.id}`}
                className="glass-media m-2 block h-56 rounded-xl"
              >
                <ProductImage
                  src={product.images[0]}
                  alt={product.name}
                  className="h-full w-full"
                  imageClassName="object-contain transition-transform duration-300 hover:scale-105"
                  surface="bg-transparent"
                />
              </Link>

              <div className="flex flex-1 flex-col p-4 pt-2">
                <p className="glass-muted mb-1 text-xs font-medium">
                  {product.brand}
                </p>
                <Link href={`/product/${product.id}`}>
                  <h3 className="glass-strong line-clamp-2 text-base font-semibold hover:underline">
                    {product.name}
                  </h3>
                </Link>

                <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="glass-price text-2xl sm:text-3xl">
                    EUR {product.price.toFixed(2)}
                  </span>
                  {product.originalPrice && (
                    <span className="glass-price-was">
                      EUR {product.originalPrice.toFixed(2)}
                    </span>
                  )}
                </div>

                <div className="mt-auto flex gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => addToCart(product, 1)}
                    className="glass-btn-primary flex-1"
                  >
                    <ShoppingCart size={15} />
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFromWishlist(product.id)}
                    title="Remove from wishlist"
                    className="glass-icon glass-icon-danger"
                    aria-label={`Remove ${product.name} from wishlist`}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
