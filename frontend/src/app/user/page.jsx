"use client";

import { Eye, PackageCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import Modal from "@/app/components/ui/Modal";
import Pagination, { usePagination } from "@/app/components/ui/Pagination";
import ProductImage from "@/app/components/ui/ProductImage";
import { lookupOrder } from "@/lib/api";
import { statusMeta } from "@/lib/orderStatus";
import { getSavedOrderNumbers } from "@/lib/orderTracking";

const unitCount = (order) =>
  order.items.reduce((total, item) => total + item.quantity, 0);

export default function UserPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  // The order whose products are shown in the modal (null = closed).
  const [selected, setSelected] = useState(null);

  // Purely a display slice — every order is still loaded and looked up exactly
  // as before, the table just shows one page of them at a time.
  const pager = usePagination(orders);

  useEffect(() => {
    const numbers = getSavedOrderNumbers();
    if (numbers.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    Promise.all(numbers.map((n) => lookupOrder(n).catch(() => null)))
      .then((results) => {
        if (!cancelled) setOrders(results.filter(Boolean));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <section className="panel overflow-hidden">
        <div className="panel-head">
          <div className="min-w-0">
            <h2 className="panel-title">Product History</h2>
            <p className="panel-sub">Orders placed from this browser.</p>
          </div>
          <span className="panel-chip">
            <PackageCheck size={18} />
          </span>
        </div>

        {loading ? (
          <p className="panel-muted p-10 text-center text-sm">Loading your orders…</p>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-4xl">📦</p>
            <p className="panel-muted">No orders yet.</p>
            <Link href="/category/all" className="glass-btn-primary">
              Start Shopping
            </Link>
          </div>
        ) : (
          <>
            {/* The table keeps its own horizontal scroll so the panel never
                pushes the page sideways on a phone. */}
            <div className="overflow-x-auto scroller">
              <table className="panel-table min-w-160">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Date</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th className="text-right">Products</th>
                  </tr>
                </thead>
                {/* Keyed on the page so React remounts the rows and the
                    fade-in in globals.css replays on every page change. */}
                <tbody key={pager.page} className="table-page-enter">
                  {pager.pageItems.map((order) => (
                    <tr key={order._id}>
                      <td className="panel-strong font-semibold">{order.orderNumber}</td>
                      <td className="panel-muted whitespace-nowrap">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      <td className="panel-muted">{unitCount(order)}</td>
                      <td className="panel-strong whitespace-nowrap font-bold">
                        EUR {order.total.toFixed(2)}
                      </td>
                      <td>
                        <span className={`badge ${statusMeta(order.status).badge}`}>
                          {statusMeta(order.status).label}
                        </span>
                      </td>
                      <td>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => setSelected(order)}
                            className="btn-icon"
                            aria-label={`View the products in order ${order.orderNumber}`}
                            title="View products"
                          >
                            <Eye size={16} />
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
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `Order ${selected.orderNumber}` : ""}
        maxWidth="max-w-xl"
        variant="glass"
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`badge ${statusMeta(selected.status).modalBadge}`}>
                {statusMeta(selected.status).label}
              </span>
              <span className="panel-muted text-xs">
                {new Date(selected.createdAt).toLocaleString()}
              </span>
            </div>

            <p className="panel-muted text-sm">{statusMeta(selected.status).hint}</p>

            <ul className="divide-y panel-divider">
              {selected.items.map((item, index) => (
                <li
                  key={`${item.productId}-${index}`}
                  className="flex items-center gap-3 py-3"
                >
                  <ProductImage
                    src={item.image}
                    alt={item.name}
                    className="glass-media h-14 w-14 shrink-0"
                    imageClassName="object-contain"
                    surface="bg-transparent"
                    sizes="56px"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="panel-strong text-sm font-medium">{item.name}</p>
                    <p className="panel-muted text-xs">
                      Qty {item.quantity} <span className="opacity-50">|</span> EUR{" "}
                      {item.price.toFixed(2)} each
                    </p>
                  </div>
                  <span className="panel-strong shrink-0 text-sm font-semibold">
                    EUR {(item.price * item.quantity).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex justify-between border-t panel-divider pt-3 text-sm font-bold">
              <span className="panel-strong">Total</span>
              <span className="panel-strong">EUR {selected.total.toFixed(2)}</span>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
