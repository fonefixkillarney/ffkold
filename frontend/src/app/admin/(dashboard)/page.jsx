"use client";

import {
  Barcode,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Euro,
  ExternalLink,
  Eye,
  Trash2,
  Truck,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import Modal from "@/app/components/ui/Modal";
import Pagination, { usePagination } from "@/app/components/ui/Pagination";
import ProductImage from "@/app/components/ui/ProductImage";
import { useAuth } from "@/context/AuthContext";
import {
  deleteOrder,
  dispatchOrderWithTracking,
  fetchOrders,
  updateOrderStatus,
} from "@/lib/api";
import {
  filterOrdersByStatus,
  ORDER_STATUS_FLOW,
  STATUS_FILTERS,
  statusGroup,
  statusMeta,
} from "@/lib/orderStatus";

// The four status actions in the modal. Each one PATCHes the order and emails
// the customer — see updateOrderStatus in the backend's orderController.
const STATUS_ACTIONS = {
  Pending: { label: "Mark as New", icon: Clock, className: "btn-sec" },
  Dispatched: { label: "Mark Dispatched", icon: Truck, className: "btn-blue" },
  Completed: {
    label: "Mark Completed",
    icon: CheckCircle2,
    className: "btn-green",
  },
  Cancelled: { label: "Cancel Order", icon: XCircle, className: "btn-delete" },
};

// One line of an order. `sourceUrl` is the supplier (mobigo.ie) page for that
// exact product — the whole row is a link to it so the admin can go straight
// there and buy the item to fulfil the order. Orders whose product no longer
// exists in the catalog have no URL, so the row stays a plain, non-clickable one.
function OrderItemRow({ item }) {
  const rowClass = "panel-box flex items-center gap-3 p-2";
  const linked = Boolean(item.sourceUrl);

  const body = (
    <>
      <ProductImage
        src={item.image}
        alt={item.name}
        className="h-12 w-12 shrink-0 rounded"
        imageClassName="object-contain"
        sizes="48px"
      />
      <div className="min-w-0 flex-1">
        <p
          className={`panel-strong truncate text-sm font-medium ${linked ? "group-hover:underline" : ""}`}
        >
          {item.name}
        </p>
        <p className="panel-muted text-xs">Qty {item.quantity}</p>
      </div>
      <span className="panel-strong shrink-0 text-sm font-semibold">
        EUR {(item.price * item.quantity).toFixed(2)}
      </span>
      {linked && (
        <ExternalLink
          size={15}
          className="panel-muted shrink-0 transition-colors group-hover:text-primary"
          aria-hidden="true"
        />
      )}
    </>
  );

  if (!linked) return <div className={rowClass}>{body}</div>;

  return (
    <a
      href={item.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open "${item.name}" on the supplier site`}
      className={`${rowClass} group cursor-pointer transition-all duration-200 hover:border-primary hover:shadow-sm`}
    >
      {body}
    </a>
  );
}

function TrackingCell({ order, editing, value, saving, onOpen, onChange, onCancel, onSave }) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
        className="flex items-center gap-1.5"
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={saving}
          placeholder="Carrier tracking ID"
          aria-label={`Tracking ID for order ${order.orderNumber}`}
          className="input-field w-40! px-2! py-1! text-xs!"
        />
        <button
          type="submit"
          disabled={saving || !value.trim()}
          className="btn-icon cursor-pointer hover:text-green-600 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Save tracking ID and dispatch order ${order.orderNumber}`}
        >
          <Check size={16} />
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="btn-icon cursor-pointer hover:text-red-600 disabled:opacity-40"
          aria-label="Cancel"
        >
          <X size={16} />
        </button>
      </form>
    );
  }

  if (order.trackingId) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title="Change this tracking ID"
        className="panel-strong cursor-pointer font-mono text-xs underline decoration-dotted underline-offset-2 transition-colors hover:text-primary-dark dark:hover:text-primary"
      >
        {order.trackingId}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="btn-sec cursor-pointer px-2.5! py-1! text-xs! whitespace-nowrap"
    >
      <Barcode size={14} />
      Add tracking ID
    </button>
  );
}

export default function AdminOrdersPage() {
  const { token } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingOrder, setViewingOrder] = useState(null);
  const [deletingOrder, setDeletingOrder] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  // Which status tab the table is showing. "All" = no filtering.
  const [filter, setFilter] = useState("All");
  // The one row whose tracking input is open, and what has been typed into it.
  // Only ever one at a time -- opening another row replaces it.
  const [trackingFor, setTrackingFor] = useState(null);
  const [trackingValue, setTrackingValue] = useState("");
  const [savingTracking, setSavingTracking] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchOrders(token)
      .then((data) => {
        if (!cancelled) setOrders(data);
      })
      .catch((error) => toast.error(error.message || "Failed to load orders"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Counts for the tab pills. Built in one pass over the orders (rather than a
  // filter per tab) and keyed by GROUP, so the legacy Viewed/Rejected statuses
  // are counted under New/Cancelled exactly as the filter itself groups them.
  const counts = useMemo(() => {
    const byGroup = { All: orders.length };
    for (const order of orders) {
      const group = statusGroup(order.status);
      byGroup[group] = (byGroup[group] || 0) + 1;
    }
    return byGroup;
  }, [orders]);

  const visibleOrders = useMemo(() => filterOrdersByStatus(orders, filter), [orders, filter]);

  // Display-only slice of `visibleOrders` — filtering, status changes and
  // deletes all still operate on the full list exactly as before.
  const pager = usePagination(visibleOrders);
  const { setPage } = pager;

  // Switching tabs starts at the top of the new result set. Without this you
  // could land on "page 4" of a filter that only has one page of matches, and
  // the clamp inside usePagination would silently drop you somewhere arbitrary.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: `filter` is the trigger, not a value read in the body.
  useEffect(() => {
    setPage(1);
  }, [filter, setPage]);

  const stats = [
    { label: "Total Orders", value: orders.length, icon: ClipboardList },
    { label: "New Orders", value: counts.Pending || 0, icon: Truck },
    {
      label: "Total Revenue",
      value: `EUR ${orders.reduce((sum, o) => sum + o.total, 0).toFixed(2)}`,
      icon: Euro,
    },
  ];

  const handleConfirmDelete = async () => {
    if (!deletingOrder) return;
    setDeleting(true);
    try {
      await deleteOrder(deletingOrder._id, token);
      setOrders((prev) => prev.filter((o) => o._id !== deletingOrder._id));
      toast.success(`Order ${deletingOrder.orderNumber} deleted`);
      setDeletingOrder(null);
    } catch (error) {
      toast.error(error.message || "Failed to delete order");
    } finally {
      setDeleting(false);
    }
  };

  const openTracking = (order) => {
    setTrackingFor(order._id);
    setTrackingValue(order.trackingId || "");
  };

  const closeTracking = () => {
    setTrackingFor(null);
    setTrackingValue("");
  };

  // Submitting the inline field IS the dispatch: one PATCH sets the tracking id
  // and the Dispatched status together, so a row can never end up dispatched
  // with nothing for the customer to track (or tracked but still sitting in New).
  const handleSaveTracking = async (order) => {
    const trackingId = trackingValue.trim();
    if (!trackingId) return;
    setSavingTracking(true);
    try {
      const { order: updated, emailed } = await dispatchOrderWithTracking(
        order._id,
        trackingId,
        token,
      );
      setOrders((prev) => prev.map((o) => (o._id === updated._id ? updated : o)));
      // Keep an open modal in sync -- it may be showing this very order.
      setViewingOrder((prev) => (prev && prev._id === updated._id ? updated : prev));
      closeTracking();
      toast.success(
        emailed
          ? `Order dispatched -- tracking ID emailed to ${updated.customer.email}`
          : "Order dispatched (customer email not sent)",
      );
    } catch (error) {
      toast.error(error.message || "Failed to save tracking ID");
    } finally {
      setSavingTracking(false);
    }
  };

  const handleSetStatus = async (status) => {
    if (!viewingOrder) return;
    setUpdatingStatus(true);
    try {
      // `emailed` is the backend's answer on the customer notification. It is
      // false when RESEND_API_KEY isn't configured, so the toast says which of
      // the two happened instead of always claiming the customer was told.
      const { order: updated, emailed } = await updateOrderStatus(viewingOrder._id, status, token);
      setOrders((prev) => prev.map((o) => (o._id === updated._id ? updated : o)));
      setViewingOrder(updated);
      const label = statusMeta(status).label;
      toast.success(
        emailed
          ? `Order marked as ${label} — customer emailed`
          : `Order marked as ${label} (customer email not sent)`,
      );
    } catch (error) {
      toast.error(error.message || "Failed to update status");
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <>
      <section className="grid gap-4 md:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="stat-card w-full">
              <div className="panel-chip mb-3">
                <Icon size={18} />
              </div>
              <p className="stat-value">{stat.value}</p>
              <p className="stat-label">{stat.label}</p>
            </div>
          );
        })}
      </section>

      <section className="panel overflow-hidden ">
        <div className="panel-head">
          <div className="min-w-0">
            <h2 className="panel-title">Orders Management</h2>
            <p className="panel-sub">
              Changing an order&apos;s status emails the customer automatically.
            </p>
          </div>
          <span className="panel-chip">
            <Truck size={18} />
          </span>
        </div>

        {/* Status filters. Client-side over the already-loaded list, so switching
            tabs is instant and never refetches. */}
        <div className="flex flex-wrap gap-2 border-b panel-divider p-4">
          {STATUS_FILTERS.map((tab) => {
            const active = filter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                aria-pressed={active}
                className={`tab-pill ${active ? "tab-pill-active" : ""}`}
              >
                {tab.label}
                <span className="tab-count">{counts[tab.key] || 0}</span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <p className="panel-muted p-6 text-center text-sm">Loading orders…</p>
        ) : orders.length === 0 ? (
          <p className="panel-muted p-6 text-center text-sm">No orders yet.</p>
        ) : visibleOrders.length === 0 ? (
          <p className="panel-muted p-6 text-center text-sm">No orders in this filter.</p>
        ) : (
          // The table keeps its own horizontal scroll so the panel never
          // pushes the page sideways on a phone. Eight columns need the
          // min-width, otherwise they crush together instead of scrolling.
          <>
            <div className="overflow-x-auto scroller">
              <table className="panel-table min-w-220">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th>Tracking</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                {/* Keyed on the page so React remounts the rows and the
                    fade-in in globals.css replays on every page change. */}
                <tbody key={pager.page} className="table-page-enter">
                  {pager.pageItems.map((order) => (
                    <tr key={order._id}>
                      <td className="panel-strong font-medium">{order.orderNumber}</td>
                      <td>
                        <p className="panel-strong font-medium">{order.customer.name}</p>
                        <p className="panel-muted text-xs">{order.customer.email}</p>
                      </td>
                      <td className="panel-muted whitespace-nowrap">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      <td className="panel-muted">{order.items.length}</td>
                      <td className="panel-strong whitespace-nowrap font-semibold">
                        EUR {order.total.toFixed(2)}
                      </td>
                      <td>
                        <TrackingCell
                          order={order}
                          editing={trackingFor === order._id}
                          value={trackingValue}
                          saving={savingTracking}
                          onOpen={() => openTracking(order)}
                          onChange={setTrackingValue}
                          onCancel={closeTracking}
                          onSave={() => handleSaveTracking(order)}
                        />
                      </td>
                      <td>
                        <span className={`badge ${statusMeta(order.status).badge}`}>
                          {statusMeta(order.status).label}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setViewingOrder(order)}
                            className="btn-icon cursor-pointer"
                            aria-label={`View order ${order.orderNumber}`}
                          >
                            <Eye size={17} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingOrder(order)}
                            className="btn-icon cursor-pointer hover:text-red-600 dark:hover:text-red-500"
                            aria-label={`Delete order ${order.orderNumber}`}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={pager.page}
              pageCount={pager.pageCount}
              total={pager.total}
              from={pager.from}
              to={pager.to}
              onChange={pager.setPage}
              label="orders"
            />
          </>
        )}
      </section>

      <Modal
        open={!!viewingOrder}
        onClose={() => setViewingOrder(null)}
        title={viewingOrder ? `Order ${viewingOrder.orderNumber}` : ""}
      >
        {viewingOrder && (
          <div className="space-y-4">
            <div className="panel-box flex items-center justify-between p-3">
              <span className="panel-muted text-sm">Status</span>
              <span className={`badge ${statusMeta(viewingOrder.status).modalBadge}`}>
                {statusMeta(viewingOrder.status).label}
              </span>
            </div>

            {viewingOrder.trackingId && (
              <div className="panel-box flex items-center justify-between gap-3 p-3">
                <span className="panel-muted shrink-0 text-sm">Tracking ID</span>
                <span className="panel-strong font-mono text-sm wrap-break-word">
                  {viewingOrder.trackingId}
                </span>
              </div>
            )}

            {/* wrap-break-word so a long email/address wraps instead of spilling out of the modal on a phone. */}
            <div className="panel-box p-3 text-sm wrap-break-word">
              <p className="panel-strong mb-1 font-semibold">Customer details</p>
              <p className="panel-muted">{viewingOrder.customer.name}</p>
              <p className="panel-muted">{viewingOrder.customer.email}</p>
              {viewingOrder.customer.phone && (
                <p className="panel-muted">{viewingOrder.customer.phone}</p>
              )}
              {viewingOrder.customer.address && (
                <p className="panel-muted">
                  {viewingOrder.customer.address}, {viewingOrder.customer.city}{" "}
                  {viewingOrder.customer.postalCode}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="panel-strong text-sm font-semibold">Items</p>
              <p className="panel-muted text-xs">
                Click an item to open it on the supplier site (mobigo.ie) and buy it there.
              </p>
              {viewingOrder.items.map((item) => (
                <OrderItemRow key={item.productId} item={item} />
              ))}
            </div>

            <div className="space-y-1 border-t panel-divider pt-3 text-sm">
              <div className="panel-muted flex justify-between">
                <span>Subtotal</span>
                <span>EUR {viewingOrder.subtotal.toFixed(2)}</span>
              </div>
              <div className="panel-muted flex justify-between">
                {/* Still summed: orders placed before the flat-delivery rule
                    carried a separate tax line. */}
                <span>Delivery</span>
                <span>EUR {(viewingOrder.shipping + viewingOrder.tax).toFixed(2)}</span>
              </div>
              <div className="panel-strong flex justify-between text-base font-bold">
                <span>Total</span>
                <span>EUR {viewingOrder.total.toFixed(2)}</span>
              </div>
            </div>

            <div className="space-y-2 border-t panel-divider pt-4">
              <p className="panel-muted text-xs">
                {viewingOrder.customer.email} is emailed about whichever status you pick.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                {ORDER_STATUS_FLOW.map((status) => {
                  const action = STATUS_ACTIONS[status];
                  const Icon = action.icon;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => handleSetStatus(status)}
                      disabled={updatingStatus || viewingOrder.status === status}
                      className={`${action.className} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <Icon size={16} />
                      {action.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!deletingOrder}
        onClose={() => !deleting && setDeletingOrder(null)}
        title="Delete order?"
        maxWidth="max-w-sm"
      >
        {deletingOrder && (
          <div className="space-y-4">
            <p className="panel-muted text-sm">
              Are you sure you want to delete order{" "}
              <strong className="panel-strong">{deletingOrder.orderNumber}</strong>? This
              cannot be undone.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              {/* <button type="button" className="btn-outline" onClick={() => setDeletingOrder(null)} disabled={deleting}>
                Cancel
              </button> */}
              <button type="button" className="btn-delete" onClick={handleConfirmDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
