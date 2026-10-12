// The order lifecycle, shared by the admin dashboard and the customer's order
// history so a status is labelled and coloured identically in both places.
//
// A freshly placed order is "Pending" (the backend default) — the dashboard
// calls that a NEW order. From there the admin moves it Dispatched → Completed,
// or Cancelled at any point. Each of those four is what the customer gets an
// email about.
//
// "Viewed" and "Rejected" are LEGACY: orders placed before this lifecycle
// existed still carry them, so both still render and still land in a filter tab
// (Viewed under New, Rejected under Cancelled), but the admin cannot set them
// anymore and the backend rejects them.

// The four statuses the admin can set, in the order the action buttons show them.
export const ORDER_STATUS_FLOW = [
  "Pending",
  "Dispatched",
  "Completed",
  "Cancelled",
];

const LEGACY_GROUP = { Viewed: "Pending", Rejected: "Cancelled" };

// Which filter tab an order belongs to. Anything unrecognised (a status written
// by an older/newer build) falls back to New rather than vanishing from the table.
export function statusGroup(status) {
  return (
    LEGACY_GROUP[status] ||
    (ORDER_STATUS_FLOW.includes(status) ? status : "Pending")
  );
}

export const STATUS_META = {
  Pending: {
    label: "New",
    // Solid neon with black text in BOTH themes. The panels are no longer cyan
    // slabs, so the badge no longer needs a dark-mode inversion to stay legible
    // — and a small neon chip on a near-black surface is exactly where the
    // accent colour belongs.
    badge: "bg-primary text-black",
    modalBadge: "bg-primary text-black",
    hint: "Your order has been received and is waiting to be processed.",
  },
  Viewed: {
    label: "Viewed",
    badge: "bg-black text-white dark:bg-white dark:text-black",
    modalBadge: "bg-black text-white dark:bg-white dark:text-black",
    hint: "The store has seen your order and it's being taken care of.",
  },
  Dispatched: {
    label: "Dispatched",
    badge: "bg-blue-600 text-white",
    modalBadge: "bg-blue-600 text-white",
    hint: "Your order has been dispatched and is on its way to you.",
  },
  Completed: {
    label: "Completed",
    badge: "bg-green-700 text-white",
    modalBadge: "bg-green-700 text-white",
    hint: "This order is complete. Thanks for shopping with us!",
  },
  Cancelled: {
    label: "Cancelled",
    badge: "bg-red-600 text-white",
    modalBadge: "bg-red-600 text-white",
    hint: "This order was cancelled and will not be dispatched. Contact support if that's unexpected.",
  },
  Rejected: {
    label: "Rejected",
    badge: "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300",
    modalBadge: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
    hint: "This order was rejected. Contact support if that's unexpected.",
  },
};

export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.Pending;
}

// The dashboard's filter tabs. "All" has no group, which is what makes it match
// everything in the filter below.
export const STATUS_FILTERS = [
  { key: "All", label: "All orders" },
  { key: "Pending", label: "New orders" },
  { key: "Dispatched", label: "Dispatched" },
  { key: "Completed", label: "Completed" },
  { key: "Cancelled", label: "Cancelled" },
];

export function filterOrdersByStatus(orders, filterKey) {
  if (filterKey === "All") return orders;
  return orders.filter((order) => statusGroup(order.status) === filterKey);
}
