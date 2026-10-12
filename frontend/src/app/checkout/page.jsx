"use client";

import {
  BadgePercent,
  Check,
  CreditCard,
  MapPin,
  PackageCheck,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import StripePayment from "@/app/components/checkout/StripePayment";
import DeliveryNotice from "@/app/components/ui/DeliveryNotice";
import ProductImage from "@/app/components/ui/ProductImage";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import {
  createOrder,
  createPaymentIntent,
  fetchPaymentConfig,
  validatePromoCode,
} from "@/lib/api";
import { saveOrderNumber } from "@/lib/orderTracking";
import {
  CHECKOUT_FORM_KEY,
  clearPendingOrder,
  savePendingOrder,
} from "@/lib/pendingOrder";
import {
  FREE_DELIVERY_THRESHOLD,
  MIN_ORDER_TOTAL,
  amountToFreeDelivery,
  computeDelivery,
  isBelowMinimum,
  round2,
} from "@/lib/pricing";

// Payment is intentionally the LAST step so the customer only pays once every
// other detail is entered and reviewed.
const steps = [
  { key: "account", label: "Account", icon: UserRound },
  { key: "shipping", label: "Shipping", icon: MapPin },
  { key: "review", label: "Review", icon: PackageCheck },
  { key: "payment", label: "Payment", icon: CreditCard },
];
const PAYMENT_STEP = steps.length - 1;

// Money rules live in src/lib/pricing.js and mirror be-eominio/utils/pricing.js.
// The server is authoritative; the imports here just drive the on-screen preview
// and the minimum-order gate.

function CheckoutForm() {
  const { cartItems, cartTotal, clearCart } = useCart();
  const { user, verifyUserInDb } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Deep-link support: /checkout?step=3 lands directly on the payment step
  // (used when returning from account creation — see the register redirect).
  const initialStep = (() => {
    const s = Number(searchParams.get("step"));
    return Number.isInteger(s) && s >= 0 && s < steps.length ? s : 0;
  })();
  const [activeStep, setActiveStep] = useState(initialStep);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    postalCode: "",
  });

  // Payment step lifecycle:
  // idle → verifying (account gate) → preparing (create intent) →
  //   ready (Stripe live) | demo (no keys yet) | redirecting | error
  const [payment, setPayment] = useState({ phase: "idle" });

  // First-order promo (each account gets its own unique code).
  const [promoInput, setPromoInput] = useState("");
  const [promoApplied, setPromoApplied] = useState(null); // { code, percent }
  const [promoError, setPromoError] = useState("");
  const [promoChecking, setPromoChecking] = useState(false);

  const setField = (field) => (event) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  // Restore any details saved before an account-creation detour so the customer
  // never has to re-type them on the way back.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(CHECKOUT_FORM_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.form) setForm((prev) => ({ ...prev, ...parsed.form }));
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  // Prefill name/email from the logged-in customer (without clobbering restored
  // values).
  useEffect(() => {
    if (!user) return;
    setForm((prev) => ({
      ...prev,
      name: prev.name || user.name || "",
      email: prev.email || user.email || "",
    }));
  }, [user]);

  // Prefill (but don't auto-apply) this account's own unique first-order code.
  useEffect(() => {
    if (user?.promoCode && !user.promoUsed) {
      setPromoInput((prev) => prev || user.promoCode);
    }
  }, [user]);

  const persistForm = useCallback(() => {
    try {
      sessionStorage.setItem(CHECKOUT_FORM_KEY, JSON.stringify({ form }));
    } catch {
      // ignore storage failures (private mode, quota)
    }
  }, [form]);

  const subtotal = cartTotal;
  const discount = promoApplied
    ? round2((subtotal * promoApplied.percent) / 100)
    : 0;
  const taxable = round2(subtotal - discount);
  // Delivery rule: under €25 → flat €5; €25 and above → free.
  const shipping = computeDelivery(taxable, cartItems.length > 0);
  const total = round2(taxable + shipping);
  const totalLabel = `EUR ${total.toFixed(2)}`;
  // Minimum-order gate, measured on the goods subtotal (pre-discount) exactly
  // as the server measures it.
  const belowMinimum = isBelowMinimum(subtotal);
  const missingForFreeDelivery = amountToFreeDelivery(taxable);

  const orderItems = useMemo(
    () =>
      cartItems.map(({ product, quantity }) => ({
        productId: product.id,
        name: product.name,
        image: product.images?.[0] || "",
        price: product.price,
        quantity,
      })),
    [cartItems],
  );

  // The order as the server wants it, minus the paymentIntentId. Also what gets
  // parked for /checkout/complete when a payment method redirects away.
  const buildOrder = useCallback(
    () => ({
      customer: {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        postalCode: form.postalCode.trim(),
      },
      items: orderItems,
      promoCode: promoApplied?.code || "",
    }),
    [form, orderItems, promoApplied],
  );

  const placeOrder = useCallback(
    async (paymentIntentId) => {
      const order = await createOrder({
        ...buildOrder(),
        paymentIntentId: paymentIntentId || undefined,
      });

      clearCart();
      clearPendingOrder();
      saveOrderNumber(order.orderNumber);
      try {
        sessionStorage.removeItem(CHECKOUT_FORM_KEY);
      } catch {
        // ignore
      }
      toast.success(`Order ${order.orderNumber} placed!`);
      router.push("/user");
    },
    [buildOrder, clearCart, router],
  );

  // Entering the payment step: require a real account (redirect to register,
  // preserving details + returning to this last step), then create the intent.
  // Deps are deliberately limited to the inputs that can change WHILE on the
  // payment step (the promo) — the rest (cart, form.email) aren't editable
  // there, so re-running on them would only churn PaymentIntents.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — see comment above
  useEffect(() => {
    if (activeStep !== PAYMENT_STEP) return;
    if (cartItems.length === 0) return;
    // Under-minimum carts never reach Stripe — the server rejects them anyway.
    if (belowMinimum) {
      setPayment({ phase: "blocked" });
      return;
    }
    let cancelled = false;

    (async () => {
      setPayment({ phase: "verifying" });
      const dbUser = await verifyUserInDb();
      if (cancelled) return;

      if (!dbUser) {
        persistForm();
        setPayment({ phase: "redirecting" });
        toast.error("Please create an account to complete payment");
        router.push(
          `/register?next=${encodeURIComponent(`/checkout?step=${PAYMENT_STEP}`)}`,
        );
        return;
      }

      setPayment({ phase: "preparing" });
      try {
        const [cfg, intent] = await Promise.all([
          fetchPaymentConfig(),
          createPaymentIntent({
            items: orderItems,
            promoCode: promoApplied?.code || "",
            email: form.email.trim() || dbUser.email,
            customer: { name: form.name.trim(), email: form.email.trim() },
          }),
        ]);
        if (cancelled) return;

        if (intent.configured && intent.clientSecret) {
          setPayment({
            phase: "ready",
            clientSecret: intent.clientSecret,
            paymentIntentId: intent.paymentIntentId,
            publishableKey: cfg.publishableKey,
            pricing: intent.pricing,
          });
        } else {
          setPayment({ phase: "demo", pricing: intent.pricing });
        }
      } catch (error) {
        if (!cancelled) {
          setPayment({ phase: "error", error: error.message });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeStep, promoApplied, belowMinimum]);

  const handleApplyPromo = async () => {
    const code = promoInput.trim();
    if (!code) return;
    if (!form.email.trim()) {
      setActiveStep(0);
      toast.error("Enter your email first so we can check the code");
      return;
    }
    setPromoChecking(true);
    setPromoError("");
    try {
      const data = await validatePromoCode(code, form.email.trim());
      setPromoApplied({ code: data.code, percent: data.percent });
      toast.success(`Code applied — ${data.percent}% off your first order!`);
    } catch (error) {
      setPromoApplied(null);
      setPromoError(error.message || "Could not validate the code");
    } finally {
      setPromoChecking(false);
    }
  };

  const removePromo = () => {
    setPromoApplied(null);
    setPromoInput("");
    setPromoError("");
  };

  const handleContinue = () => {
    if (belowMinimum) {
      toast.error(
        `Minimum checkout is EUR ${MIN_ORDER_TOTAL.toFixed(2)} — add a little more to continue`,
      );
      return;
    }
    if (activeStep === 0 && (!form.name.trim() || !form.email.trim())) {
      toast.error("Please fill in your name and email");
      return;
    }
    setActiveStep((step) => Math.min(steps.length - 1, step + 1));
  };

  const handleDemoOrder = async () => {
    setPayment((p) => ({ ...p, placing: true }));
    try {
      await placeOrder(null);
    } catch (error) {
      toast.error(error.message || "Failed to place order");
      setPayment((p) => ({ ...p, placing: false }));
    }
  };

  if (cartItems.length === 0) {
    return (
      <div className="container-main py-20 text-center">
        <p className="mb-4 text-5xl">🛒</p>
        <h2 className="mb-2 text-2xl font-bold text-gray-700 dark:text-gray-200">
          Your cart is empty
        </h2>
        <p className="mb-6 text-gray-500 dark:text-gray-400">
          Add some products before checking out.
        </p>
        <Link href="/category/all" className="btn-primary">
          Browse Products
        </Link>
      </div>
    );
  }

  return (
    <div className="container-main py-6">
      <div className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">
          Checkout
        </p>
        <h1>Checkout</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Complete your details below — you&apos;ll pay in the final step.
        </p>
      </div>

      <DeliveryNotice className="mb-6" />

      {belowMinimum && (
        <p className="mb-6 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Your items come to EUR {subtotal.toFixed(2)}. The minimum checkout is
            EUR {MIN_ORDER_TOTAL.toFixed(2)} — add EUR{" "}
            {round2(MIN_ORDER_TOTAL - subtotal).toFixed(2)} more to place this
            order.{" "}
            <Link href="/category/all" className="underline">
              Browse products
            </Link>
          </span>
        </p>
      )}

      {/* Two-up on phones: stacked full-width, the four steps were a screenful
          of their own and pushed the form the shopper came here to fill in
          below the fold. */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const complete = index < activeStep;
          const active = index === activeStep;
          return (
            <button
              key={step.key}
              type="button"
              onClick={() => setActiveStep(index)}
              className={`flex min-w-0 items-center gap-2 rounded border p-2.5 text-left transition-all sm:gap-3 sm:p-3 ${active || complete
                ? "border-primary bg-primary text-black"
                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:border-gray-300"
                }`}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-black sm:h-8 sm:w-8">
                {complete ? (
                  <Check size={16} className="text-green-600" />
                ) : (
                  <Icon size={16} />
                )}
              </span>
              <span className="truncate text-xs font-semibold sm:text-sm">
                {step.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* grid-cols-1 (= minmax(0,1fr)) + min-w-0 on both cards: without them the
          phone column is `auto` and sizes to its widest unbreakable content —
          the nowrap product name — pushing both cards off the right edge. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-200 dark:bg-primary p-4 shadow-sm sm:p-5">
          {activeStep === 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="checkout-name" className="mb-1 block text-sm font-medium text-black">
                  Full name
                </label>
                <input id="checkout-name" className="input-field" value={form.name} onChange={setField("name")} />
              </div>
              <div>
                <label htmlFor="checkout-email" className="mb-1 block text-sm font-medium text-black">
                  Email address
                </label>
                <input id="checkout-email" type="email" className="input-field" value={form.email} onChange={setField("email")} />
              </div>
              <div>
                <label htmlFor="checkout-phone" className="mb-1 block text-sm font-medium text-black">
                  Phone number
                </label>
                <input id="checkout-phone" className="input-field" value={form.phone} onChange={setField("phone")} />
              </div>
            </div>
          )}

          {activeStep === 1 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label htmlFor="checkout-address" className="mb-1 block text-sm font-medium text-black">
                  Street address
                </label>
                <input id="checkout-address" className="input-field" value={form.address} onChange={setField("address")} />
              </div>
              <div>
                <label htmlFor="checkout-city" className="mb-1 block text-sm font-medium text-black">
                  City
                </label>
                <input id="checkout-city" className="input-field" value={form.city} onChange={setField("city")} />
              </div>
              <div>
                <label htmlFor="checkout-postal" className="mb-1 block text-sm font-medium text-black">
                  Postal code
                </label>
                <input id="checkout-postal" className="input-field" value={form.postalCode} onChange={setField("postalCode")} />
              </div>
              {/* One delivery tier, priced by order value — nothing to pick. */}
              <div className="md:col-span-2 rounded border border-gray-300 dark:border-black/40 p-3 text-sm text-black">
                <p className="font-semibold text-black">
                  Delivery —{" "}
                  {shipping === 0 ? "Free" : `EUR ${shipping.toFixed(2)}`}
                </p>
                <p className="mt-1 text-xs text-gray-600 dark:text-black/70">
                  Next day delivery if you order before 2PM. Flat EUR{" "}
                  {shipping === 0 ? "5.00" : shipping.toFixed(2)} under EUR{" "}
                  {FREE_DELIVERY_THRESHOLD.toFixed(2)}, free from EUR{" "}
                  {FREE_DELIVERY_THRESHOLD.toFixed(2)}.
                </p>
              </div>
            </div>
          )}

          {activeStep === 2 && (
            <div className="space-y-4">
              <div className="rounded border border-gray-300 dark:border-black/40 p-3 sm:p-4">
                <h3 className="mb-2 text-base dark:text-black">Delivery Details</h3>
                <p className="wrap-break-word text-sm text-gray-500 dark:text-black/70">
                  {form.name || "—"}, {form.address || "—"}, {form.city || "—"}{" "}
                  {form.postalCode}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-black/70">
                  Delivery — {shipping === 0 ? "Free" : `EUR ${shipping.toFixed(2)}`}
                  , next day if you order before 2PM
                </p>
              </div>
              <div className="rounded border border-gray-300 dark:border-black/40 p-3 sm:p-4">
                <h3 className="mb-2 text-base dark:text-black">Contact</h3>
                <p className="wrap-anywhere text-sm text-gray-500 dark:text-black/70">
                  {form.email || "—"} {form.phone && `· ${form.phone}`}
                </p>
              </div>
              <p className="text-sm text-gray-600 dark:text-black/70">
                Everything look right? Continue to payment to finish your order.
              </p>
            </div>
          )}

          {activeStep === 3 && (
            <div className="space-y-4">
              <h3 className="text-base dark:text-black">Payment</h3>

              {(payment.phase === "verifying" ||
                payment.phase === "preparing" ||
                payment.phase === "redirecting" ||
                payment.phase === "idle") && (
                  <p className="text-sm text-gray-600 dark:text-black/70">
                    {payment.phase === "verifying"
                      ? "Checking your account…"
                      : payment.phase === "redirecting"
                        ? "Redirecting to create your account…"
                        : "Preparing secure payment…"}
                  </p>
                )}

              {payment.phase === "blocked" && (
                <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                  Minimum checkout is EUR {MIN_ORDER_TOTAL.toFixed(2)}. Add EUR{" "}
                  {round2(MIN_ORDER_TOTAL - subtotal).toFixed(2)} more to your
                  cart to pay.
                </p>
              )}

              {payment.phase === "ready" && (
                <StripePayment
                  publishableKey={payment.publishableKey}
                  clientSecret={payment.clientSecret}
                  onSuccess={placeOrder}
                  onBeforeConfirm={() =>
                    savePendingOrder(payment.paymentIntentId, buildOrder())
                  }
                  totalLabel={totalLabel}
                />
              )}

              {payment.phase === "demo" && (
                <div className="space-y-4">
                  <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 sm:p-4">
                    Payment is not configured yet (Stripe keys pending). You can
                    place a demo order to test the rest of the flow — no real
                    charge is made.
                  </div>
                  <button
                    type="button"
                    className="btn-primary-lg w-full"
                    onClick={handleDemoOrder}
                    disabled={payment.placing}
                  >
                    {payment.placing ? "Placing Order…" : `Place Demo Order (${totalLabel})`}
                  </button>
                </div>
              )}

              {payment.phase === "error" && (
                <div className="space-y-3">
                  <p className="wrap-break-word text-sm text-red-600 dark:text-red-700">
                    {payment.error || "Could not start payment."}
                  </p>
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => setActiveStep(PAYMENT_STEP)}
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex justify-between gap-3 border-t border-gray-300 dark:border-black/30 pt-4">
            <button
              type="button"
              className="btn-outline"
              disabled={activeStep === 0}
              onClick={() => setActiveStep((step) => Math.max(0, step - 1))}
            >
              Back
            </button>
            <button
              type="button"
              className="border px-4 py-2 rounded-md bg-yellow-300 font-semibold text-black"
              disabled={activeStep === steps.length - 1 || belowMinimum}
              onClick={handleContinue}
            >
              Continue
            </button>
          </div>
        </section>

        <aside className="h-fit min-w-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-200 dark:bg-primary p-4 shadow-sm sm:p-5">
          <h2 className="mb-4 text-lg text-black">Order Preview</h2>
          <div className="space-y-3">
            {cartItems.map(({ product, quantity }) => (
              <div key={product.id} className="flex gap-3">
                <ProductImage
                  src={product.images[0]}
                  alt={product.name}
                  className="h-14 w-14 shrink-0 rounded"
                  imageClassName="object-contain"
                  sizes="56px"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-black">
                    {product.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-black/70">
                    Qty {quantity}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-black">
                  EUR {(product.price * quantity).toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-4">
            <label htmlFor="checkout-promo" className="mb-1 block text-sm font-medium text-gray-700 dark:text-black">
              Promo code
            </label>
            {promoApplied ? (
              <div className="flex items-center justify-between gap-2 rounded border border-primary-dark bg-primary-light px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-black">
                  <BadgePercent size={15} className="shrink-0" />
                  <span className="truncate">
                    {promoApplied.code} — {promoApplied.percent}% off
                  </span>
                </span>
                <button
                  type="button"
                  onClick={removePromo}
                  className="shrink-0 text-gray-500 hover:text-black transition-colors"
                  aria-label="Remove promo code"
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  id="checkout-promo"
                  className="input-field min-w-0"
                  placeholder="Your first-order code"
                  maxLength={20}
                  value={promoInput}
                  onChange={(event) => setPromoInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleApplyPromo();
                  }}
                />
                <button
                  type="button"
                  className="btn-primary shrink-0"
                  onClick={handleApplyPromo}
                  disabled={promoChecking || !promoInput.trim()}
                >
                  {promoChecking ? "Checking…" : "Apply"}
                </button>
              </div>
            )}
            {promoError && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-700">{promoError}</p>
            )}
            {!promoApplied && !promoError && (
              <p className="mt-1 text-xs text-gray-400 dark:text-black/60">
                Every new account gets its own 10% first-order code — register to
                get yours.
              </p>
            )}
          </div>

          <div className="mt-4 space-y-2 border-t border-gray-100 dark:border-gray-800 pt-4 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-gray-500 dark:text-black">Subtotal</span>
              <span className="shrink-0 whitespace-nowrap font-semibold text-gray-800">EUR {subtotal.toFixed(2)}</span>
            </div>
            {promoApplied && (
              <div className="flex justify-between gap-3">
                <span className="text-gray-500 dark:text-black">
                  First order discount ({promoApplied.percent}%)
                </span>
                <span className="shrink-0 whitespace-nowrap font-semibold text-green-600 dark:text-green-700">
                  − EUR {discount.toFixed(2)}
                </span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-gray-500 dark:text-black">
                Delivery {shipping > 0 ? `(orders under €${FREE_DELIVERY_THRESHOLD})` : ""}
              </span>
              <span className="shrink-0 whitespace-nowrap font-semibold text-gray-800">
                {shipping === 0 ? "Free" : `EUR ${shipping.toFixed(2)}`}
              </span>
            </div>
            {missingForFreeDelivery > 0 && !belowMinimum && (
              <p className="text-xs text-gray-500 dark:text-black/70">
                Add EUR {missingForFreeDelivery.toFixed(2)} more for free delivery.
              </p>
            )}
            <div className="flex justify-between gap-3 text-base font-bold">
              <span className="text-gray-800">Total</span>
              <span className="shrink-0 whitespace-nowrap text-black">EUR {total.toFixed(2)}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutForm />
    </Suspense>
  );
}
