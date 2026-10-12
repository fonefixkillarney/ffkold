import { Clock, Truck } from "lucide-react";
import {
  DELIVERY_FEE,
  FREE_DELIVERY_THRESHOLD,
  MIN_ORDER_TOTAL,
} from "@/lib/pricing";

// The two promises the hero slider opens the site with, repeated on every page
// of the checkout flow so the rules are never a surprise at the payment step.
// Permanently black/neon (like the site chrome), not theme-conditional.
export default function DeliveryNotice({ className = "" }) {
  return (
    <div
      className={`flex flex-col shiner justify-center items-center gap-2 rounded-lg border border-primary-dark bg-black px-3 py-6 ${className}`}
    >
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary sm:text-lg">
        <Clock size={20} className="shrink-0" aria-hidden="true" />
        Next day delivery if you order before 2PM
      </p>
      <p className="flex items-center gap-2 text-xs text-white sm:text-lg">
        <Truck size={20} className="shrink-0 text-primary" aria-hidden="true" />
        <span>
          Minimum checkout <strong className="text-primary">€{MIN_ORDER_TOTAL}</strong> ||{" "}
          <strong className="text-red-500">€{DELIVERY_FEE}</strong> delivery under €
          {FREE_DELIVERY_THRESHOLD} ·{" "}||
          <strong className="text-green-500"> Free delivery</strong> over €
          {FREE_DELIVERY_THRESHOLD}
        </span>
      </p>
    </div>
  );
}
