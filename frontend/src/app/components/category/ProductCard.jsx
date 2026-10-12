"use client";

import { Heart, Maximize2, ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";
import ImageLightbox from "@/app/components/ui/ImageLightbox";
import ProductImage from "@/app/components/ui/ProductImage";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useData } from "@/context/DataContext";
import { useWishlist } from "@/context/WishlistContext";
import { deleteProduct } from "@/lib/api";

export default function ProductCard({ product, view = "grid", style }) {
  const { addToCart } = useCart();
  const { isWishlisted, toggleWishlist } = useWishlist();
  const { isAdmin, token } = useAuth();
  const { removeProductLocal } = useData();
  const wishlisted = isWishlisted(product.id);
  const inStock = product.stock > 0;
  const [showLightbox, setShowLightbox] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const openLightbox = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowLightbox(true);
  };

  const handleDelete = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      !window.confirm(
        `Permanently delete "${product.name}"?\n\nThis cannot be undone — the product is removed from the database and will never be re-added by a future scrape.`,
      )
    )
      return;

    setDeleting(true);
    try {
      await deleteProduct(product.id, token);
      removeProductLocal(product.id);
      toast.success("Product deleted permanently.");
    } catch (error) {
      toast.error(error.message || "Delete failed");
      setDeleting(false);
    }
  };

  const deleteButton = (extraClass = "") => (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      title="Delete this product permanently"
      aria-label={`Delete ${product.name}`}
      className={`glass-icon glass-icon-danger z-20 h-8 w-8 rounded-full ${extraClass}`}
    >
      <Trash2 size={15} />
    </button>
  );

  const wishlistButton = (extraClass = "") => (
    <button
      type="button"
      onClick={() => toggleWishlist(product)}
      className={`glass-fab ${wishlisted ? "glass-fab-on" : ""} ${extraClass}`}
      aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
      aria-pressed={wishlisted}
    >
      <Heart size={17} fill={wishlisted ? "currentColor" : "none"} />
    </button>
  );

  if (view === "list") {
    return (
      <div className="glass-card animate-fade-up gap-3 p-3 sm:gap-4" style={style}>
        {showLightbox && (
          <ImageLightbox
            src={product.images[0]}
            alt={product.name}
            onClose={() => setShowLightbox(false)}
          />
        )}
        <Link
          href={`/product/${product.id}`}
          className="glass-media group/image h-24 w-24 shrink-0 sm:h-32 sm:w-32"
        >
          <ProductImage
            src={product.images[0]}
            alt={product.name}
            className="h-full w-full"
            imageClassName="object-contain transition-transform duration-300 group-hover/image:scale-105"
            surface="bg-transparent"
            sizes="(min-width: 640px) 128px, 96px"
            variant="thumb"
          />
          <button
            type="button"
            onClick={openLightbox}
            className="glass-fab absolute top-1 right-1 h-6 w-6 opacity-0 transition-opacity duration-200 group-hover/image:opacity-100"
            aria-label="Large view"
          >
            <Maximize2 size={12} />
          </button>
        </Link>

        <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
          <div>
            <p className="glass-muted mb-0.5 text-xs font-medium">{product.brand}</p>
            <Link href={`/product/${product.id}`}>
              <h4 className="glass-strong line-clamp-2 text-base leading-snug font-semibold hover:underline">
                {product.name}
              </h4>
            </Link>
            <p className="glass-faint mt-1 line-clamp-2 text-xs">
              {product.description}
            </p>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="glass-price text-2xl sm:text-3xl">
                €{product.price.toFixed(2)}
              </span>
              {product.originalPrice > 0 &&
                product.originalPrice !== product.price && (
                  <span className="glass-price-was ml-2">
                    €{product.originalPrice.toFixed(2)}
                  </span>
                )}
            </div>
            <div className="flex items-center gap-2">
              {wishlistButton()}
              <button
                type="button"
                onClick={() => inStock && addToCart(product, 1)}
                disabled={!inStock}
                className="darkglass-btn-primary gap-1 px-3 py-1.5 text-xs"
              >
                <ShoppingCart size={12} />
                {inStock ? "Add to Cart" : "Out of Stock"}
              </button>
              {isAdmin && deleteButton()}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card panel group animate-fade-up flex-col" style={style}>
      {showLightbox && (
        <ImageLightbox
          src={product.images[0]}
          alt={product.name}
          onClose={() => setShowLightbox(false)}
        />
      )}

      <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
        {product.isNew && <span className="glass-flag">NEW</span>}
        {product.isSale && <span className="glass-flag glass-flag-sale">SALE</span>}
      </div>

      {wishlistButton("absolute top-2 right-2 z-10")}

      {/* Image. Below sm the grid runs two ~160px columns on a phone, so the
          image, type and button all step down there; sm and up are unchanged. */}
      <Link
        href={`/product/${product.id}`}
        className="glass-media group/image m-1.5 block h-32 rounded-xl sm:m-2 sm:h-48"
      >
        <ProductImage
          src={product.images[0]}
          alt={product.name}
          className="h-full w-full"
          imageClassName="object-contain transition-transform duration-300 group-hover/image:scale-105"
          surface="bg-transparent"
        />
      </Link>

      {/* Info */}
      <div className="flex flex-1 flex-col p-2.5 pt-1 sm:p-4 sm:pt-2">
        <p className="glass-muted mb-1 truncate text-xs">{product.brand}</p>
        <Link href={`/product/${product.id}`}>
          <h4 className="glass-strong mb-1 line-clamp-2 text-[13px] leading-snug font-semibold hover:underline sm:text-sm">
            {product.name}
          </h4>
        </Link>

        <div className="mt-auto">
          {/* Price — wraps the old price under the new one in a narrow column. */}
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="glass-price text-xl sm:text-3xl">€{product.price.toFixed(2)}</span>
            {product.originalPrice > 0 &&
              product.originalPrice !== product.price && (
                <span className="glass-price-was text-xs sm:text-sm">
                  €{product.originalPrice.toFixed(2)}
                </span>
              )}
          </div>

          {/* Stock — admin-only, like the delete icon. */}
          {isAdmin && (
            <div className="mb-2 sm:mb-3">
              <span
                className={`glass-badge ${inStock ? "glass-badge-ok" : "glass-badge-no"}`}
              >
                {inStock ? "In Stock" : "Out of Stock"}
              </span>
            </div>
          )}

          {/* Add to Cart */}
          <button
            type="button"
            onClick={() => inStock && addToCart(product, 1)}
            disabled={!inStock}
            className="dark:hidden bg-yellow-400 hover:bg-yellow-500 duration-150 text-black rounded-lg flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm dark:glass-btn-primary w-full sm:gap-3 sm:p-3 sm:text-base"
          >
            <ShoppingCart size={20} className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            {inStock ? "Add to Cart" : "Out of Stock"}
          </button>
          <button
            type="button"
            onClick={() => inStock && addToCart(product, 1)}
            disabled={!inStock}
            className="dark:block hidden glass-btn-primary w-full gap-1.5 dark:flex! items-center justify-center px-2 py-2.5 sm:gap-3 sm:p-3"
          >
            <ShoppingCart size={20} className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            {inStock ? "Add to Cart" : "Out of Stock"}
          </button>
        </div>
      </div>

      {isAdmin && deleteButton("absolute bottom-3 right-3")}
    </div>
  );
}
