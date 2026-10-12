"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useCart } from "@/context/CartContext";
import { createOrder } from "@/lib/api";
import { saveOrderNumber } from "@/lib/orderTracking";
import {
  CHECKOUT_FORM_KEY,
  clearPendingOrder,
  getPendingOrder,
} from "@/lib/pendingOrder";

// Stripe's return_url for redirect-based payment methods (Revolut Pay,
// Satispay). Stripe appends ?payment_intent=…&redirect_status=… and this page
// places the order from the payload the checkout parked just before confirming.
// The server re-verifies the PaymentIntent (succeeded, amount, not reused), so
// nothing here is trusted beyond "which order to try".
function CheckoutComplete() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { clearCart } = useCart();
  const [state, setState] = useState({ phase: "placing" });
  // Once per page load — StrictMode's double effect would otherwise place the
  // same order twice (the second attempt 409s on the reused PaymentIntent).
  const started = useRef(false);

  const paymentIntentId = searchParams.get("payment_intent");
  const redirectStatus = searchParams.get("redirect_status");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!paymentIntentId) {
      router.replace("/checkout");
      return;
    }

    const pending = getPendingOrder();
    const matches = pending?.paymentIntentId === paymentIntentId;

    // Declined or cancelled in the provider's app: straight back to the payment
    // step with the details still filled in, so they can pick another method.
    if (redirectStatus === "failed") {
      if (matches && pending.order?.customer) {
        try {
          sessionStorage.setItem(
            CHECKOUT_FORM_KEY,
            JSON.stringify({ form: pending.order.customer }),
          );
        } catch {
          // ignore storage failures (private mode, quota)
        }
      }
      toast.error("Payment was not completed — please try again");
      router.replace("/checkout?step=3");
      return;
    }

    if (!matches) {
      setState({ phase: "missing" });
      return;
    }

    (async () => {
      try {
        const order = await createOrder({ ...pending.order, paymentIntentId });
        clearPendingOrder();
        clearCart();
        saveOrderNumber(order.orderNumber);
        try {
          sessionStorage.removeItem(CHECKOUT_FORM_KEY);
        } catch {
          // ignore
        }
        toast.success(`Order ${order.orderNumber} placed!`);
        // replace, not push: Back shouldn't land on this page and retry.
        router.replace("/user");
      } catch (error) {
        setState({ phase: "error", error: error.message });
      }
    })();
  }, [paymentIntentId, redirectStatus, router, clearCart]);

  if (state.phase === "placing") {
    return (
      <div className="container-main py-20 text-center">
        <LoaderCircle
          size={40}
          className="mx-auto mb-4 animate-spin text-primary"
          aria-hidden="true"
        />
        <h2 className="mb-2 text-2xl font-bold text-gray-700 dark:text-gray-200">
          Confirming your payment…
        </h2>
        <p className="text-gray-500 dark:text-gray-400">
          Please don&apos;t close this page.
        </p>
      </div>
    );
  }

  // "missing": this browser has no parked order for the payment (a different
  // browser/device, or storage was cleared). "error": the payment went through
  // but the server refused the order. Either way the customer may have been
  // charged, so give them the reference to quote.
  return (
    <div className="container-main py-20 text-center">
      <TriangleAlert
        size={40}
        className="mx-auto mb-4 text-amber-500"
        aria-hidden="true"
      />
      <h2 className="mb-2 text-2xl font-bold text-gray-700 dark:text-gray-200">
        {state.phase === "missing"
          ? "We couldn't find this order"
          : "We couldn't place your order"}
      </h2>
      <p className="mx-auto mb-2 max-w-lg text-gray-500 dark:text-gray-400">
        {state.phase === "missing"
          ? "If you already completed this payment, your order may have been placed — check your orders."
          : state.error}
      </p>
      <p className="mx-auto mb-6 max-w-lg text-sm text-gray-500 dark:text-gray-400">
        If you were charged, contact us and quote payment reference{" "}
        <span className="wrap-anywhere font-mono">{paymentIntentId}</span>.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/user" className="btn-primary">
          View my orders
        </Link>
        <Link href="/checkout" className="btn-outline">
          Back to checkout
        </Link>
      </div>
    </div>
  );
}

export default function CheckoutCompletePage() {
  return (
    <Suspense fallback={null}>
      <CheckoutComplete />
    </Suspense>
  );
}
