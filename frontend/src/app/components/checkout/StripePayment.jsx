"use client";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useState } from "react";
import toast from "react-hot-toast";

let stripePromiseCache = { key: null, promise: null };
function getStripePromise(key) {
  if (!key) return null;
  if (stripePromiseCache.key !== key) {
    stripePromiseCache = { key, promise: loadStripe(key) };
  }
  return stripePromiseCache.promise;
}

// Where redirect-based methods land after the provider's page/app.
const RETURN_PATH = "/checkout/complete";

function PaymentForm({ onSuccess, onBeforeConfirm, totalLabel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);

    // Must happen BEFORE confirming: a redirect method navigates away inside
    // confirmPayment, so there's no chance to save anything afterwards.
    onBeforeConfirm?.();

    // Cards (and MB WAY, which waits for in-app approval) resolve in place.
    // Revolut Pay and Satispay pass the intent's allow_redirects:"never" filter
    // — they can finish via QR code on desktop — but still redirect on phones,
    // and Stripe refuses to confirm them without a return_url.
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}${RETURN_PATH}`,
      },
      redirect: "if_required",
    });

    if (error) {
      toast.error(error.message || "Payment failed");
      setSubmitting(false);
      return;
    }

    if (paymentIntent?.status === "succeeded") {
      try {
        await onSuccess(paymentIntent.id);
      } catch {
        // onSuccess surfaces its own error toast; keep the user on the page.
      } finally {
        setSubmitting(false);
      }
      return;
    }

    toast.error("Payment could not be completed");
    setSubmitting(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded border border-gray-300 dark:border-black/40 bg-white p-4">
        <PaymentElement />
      </div>
      <button
        type="button"
        className="border px-4 py-2 rounded-md bg-yellow-300 font-semibold text-black"
        onClick={handlePay}
        disabled={!stripe || submitting}
      >
        {submitting ? "Processing…" : `Pay ${totalLabel}`}
      </button>
      <p className="text-xs text-gray-500 dark:text-black/60">
        Payments are processed securely by Stripe.
      </p>
    </div>
  );
}

export default function StripePayment({
  publishableKey,
  clientSecret,
  onSuccess,
  onBeforeConfirm,
  totalLabel,
}) {
  const stripePromise = getStripePromise(publishableKey);
  if (!stripePromise || !clientSecret) return null;

  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret, appearance: { theme: "stripe" } }}
    >
      <PaymentForm
        onSuccess={onSuccess}
        onBeforeConfirm={onBeforeConfirm}
        totalLabel={totalLabel}
      />
    </Elements>
  );
}
