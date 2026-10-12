"use client";

import { Minus, Plus, ShoppingBag, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import DeliveryNotice from "@/app/components/ui/DeliveryNotice";
import ProductImage from "@/app/components/ui/ProductImage";
import { useCart } from "@/context/CartContext";
import {
  MIN_ORDER_TOTAL,
  amountToFreeDelivery,
  computeDelivery,
  isBelowMinimum,
  round2,
} from "@/lib/pricing";

export default function CartPage() {
  const { cartItems, cartTotal, removeFromCart, updateQuantity } = useCart();
  const subtotal = cartTotal;
  // Same rules the checkout and the server apply — see src/lib/pricing.js.
  const belowMinimum = isBelowMinimum(subtotal);
  const shipping = computeDelivery(subtotal, cartItems.length > 0);
  const missingForFreeDelivery = amountToFreeDelivery(subtotal);
  const total = round2(subtotal + shipping);

  // `.glass-shell` is what makes the glass read as glass: it paints the aurora
  // these panels blur. Without it they would be translucent sheets over a flat
  // white page, i.e. invisible. Every glassy route wraps its content this way.
  if (cartItems.length === 0) {
    return (
      <div className="glass-shell">
        <div className="container-main py-20">
          <div className="glass-panel mx-auto max-w-md p-10 text-center">
            <p className="mb-4 text-5xl">🛒</p>
            <h2 className="glass-strong mb-2 text-2xl font-bold">
              Your cart is empty
            </h2>
            <p className="glass-muted mb-6">
              Browse our products and add something you like.
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
              Cart
            </p>
            <h1 className="glass-strong">Shopping Cart</h1>
            <p className="glass-muted text-sm">
              Review your products before checkout.
            </p>
          </div>
          <Link href="/category/all" className="glass-btn-primary w-fit">
            Add More Products
          </Link>
        </div>

        <DeliveryNotice className="mb-6" />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Phones keep the photo beside the name (a full-width 112px-tall
              letterboxed thumbnail was most of the row) and wrap the quantity and
              remove controls onto a line of their own; from sm the three sit side
              by side as before. */}
          <section className="space-y-3">
            {cartItems.map(({ product, quantity }) => (
              <article
                key={product.id}
                className="glass-card flex-wrap items-center gap-3 p-3 sm:flex-nowrap sm:gap-4 sm:p-4"
              >
                <Link
                  href={`/product/${product.id}`}
                  className="glass-media h-24 w-24 shrink-0 sm:h-28 sm:w-28"
                >
                  <ProductImage
                    src={product.images[0]}
                    alt={product.name}
                    className="h-full w-full"
                    imageClassName="object-contain"
                    surface="bg-transparent"
                    sizes="(min-width: 640px) 112px, 96px"
                  />
                </Link>

                <div className="min-w-0 flex-1">
                  <p className="glass-muted text-xs font-medium">{product.brand}</p>
                  <Link href={`/product/${product.id}`}>
                    <h3 className="glass-strong line-clamp-2 text-base hover:underline">
                      {product.name}
                    </h3>
                  </Link>
                  <p className="glass-price mt-1 text-lg">
                    EUR {product.price.toFixed(2)}
                  </p>
                </div>

                <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="glass-qty"
                      disabled={quantity <= 1}
                      onClick={() => updateQuantity(product.id, quantity - 1)}
                      aria-label="Decrease quantity"
                    >
                      <Minus size={13} />
                    </button>
                    <span className="glass-qty-value">{quantity}</span>
                    <button
                      type="button"
                      className="glass-qty"
                      disabled={quantity >= product.stock}
                      onClick={() => updateQuantity(product.id, quantity + 1)}
                      aria-label="Increase quantity"
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="glass-icon glass-icon-danger"
                    onClick={() => removeFromCart(product.id)}
                    aria-label={`Remove ${product.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </section>

          <aside className="glass-panel h-fit p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="glass-chip">
                <ShoppingBag size={18} />
              </span>
              <h2 className="glass-title">Order Summary</h2>
            </div>

            <div className="glass-divider space-y-3 border-b pb-4 text-sm">
              <div className="flex justify-between">
                <span className="glass-muted">Subtotal</span>
                <span className="glass-strong font-semibold">
                  EUR {subtotal.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="glass-muted">Delivery</span>
                <span className="glass-strong font-semibold">
                  {shipping === 0 ? "Free" : `EUR ${shipping.toFixed(2)}`}
                </span>
              </div>
              {missingForFreeDelivery > 0 && !belowMinimum && (
                <p className="glass-faint text-xs">
                  Add EUR {missingForFreeDelivery.toFixed(2)} more for free delivery.
                </p>
              )}
            </div>

            <div className="my-4 flex items-baseline justify-between">
              <span className="glass-strong text-lg font-bold">Total</span>
              <span className="glass-price text-2xl">EUR {total.toFixed(2)}</span>
            </div>

            {/* Under the minimum the checkout can't proceed — the server rejects
                it too, so this is the friendly half of the same rule. */}
            {belowMinimum ? (
              <>
                <p className="mb-3 flex items-start gap-2 rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    Minimum checkout is EUR {MIN_ORDER_TOTAL.toFixed(2)}. Add EUR{" "}
                    {round2(MIN_ORDER_TOTAL - subtotal).toFixed(2)} more to continue.
                  </span>
                </p>
                <button type="button" className="glass-btn-primary w-full py-3" disabled>
                  Proceed to Checkout
                </button>
              </>
            ) : (
              <Link href="/checkout" className="glass-btn-primary w-full py-3">
                Proceed to Checkout
              </Link>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
