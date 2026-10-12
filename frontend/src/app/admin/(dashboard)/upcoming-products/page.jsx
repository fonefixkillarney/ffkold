"use client";

import {
  ArrowUpRight,
  Check,
  ExternalLink,
  Loader2,
  PackagePlus,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import Modal from "@/app/components/ui/Modal";
import Pagination, { usePagination } from "@/app/components/ui/Pagination";
import ProductImage from "@/app/components/ui/ProductImage";
import { useAuth } from "@/context/AuthContext";
import { useData } from "@/context/DataContext";
import {
  approveBanner,
  approveProduct,
  deleteProduct,
  fetchPendingItems,
  updateProductPrice,
} from "@/lib/api";
import {
  nodeHref,
  productCategoryPaths,
  resolveCategoryChain,
  splitCategoryPath,
} from "@/lib/categoryPath";


function ProductDestinations({ product, categories }) {
  const chains = productCategoryPaths(product)
    .map((path) => {
      const slugs = splitCategoryPath(path);
      const chain = resolveCategoryChain(categories, slugs);
      return {
        href: nodeHref(slugs),
        labels: chain.length ? chain.map((c) => c.label) : slugs,
        resolved: chain.length > 0,
      };
    })
    .filter((c) => c.labels.length);

  if (!chains.length) {
    return <span className="panel-muted text-xs">Uncategorised</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      {chains.map((c) => (
        <a
          key={c.href}
          href={c.href}
          target="_blank"
          rel="noreferrer"
          title={c.resolved ? undefined : "Not in the sidebar tree"}
          className={`text-xs transition-colors hover:underline ${c.resolved ? "panel-strong" : "panel-muted"
            }`}
        >
          {c.labels.join(" › ")}
        </a>
      ))}
    </div>
  );
}


function DetailField({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div>
      <dt className="panel-muted text-[10px] uppercase tracking-wide">{label}</dt>
      <dd className="panel-strong text-sm wrap-break-word">{value}</dd>
    </div>
  );
}


function QueueSection({ title, count, children, footer }) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        <span className="tab-count px-2.5! py-1! text-xs!">{count}</span>
      </div>
      <div className="overflow-x-auto scroller">{children}</div>
      {footer}
    </section>
  );
}

export default function AdminUpcomingProductsPage() {
  const { token } = useAuth();
  const { categories, refreshData } = useData();
  const router = useRouter();

  const [pending, setPending] = useState({ products: [], banners: [] });
  const [loading, setLoading] = useState(true);
  // Ids approved during this visit. The row stays on screen (rather than
  // vanishing) so the Navigate button it reveals is actually clickable.
  const [approved, setApproved] = useState(() => new Set());
  const [busy, setBusy] = useState(null);
  // Price edit is per-row: only one product is editable at a time, and the
  // edit has to be saved (or cancelled) before that row can be approved.
  const [editing, setEditing] = useState(null);
  const [priceInput, setPriceInput] = useState("");
  const [originalPriceInput, setOriginalPriceInput] = useState("");
  const [savingPrice, setSavingPrice] = useState(false);
  // Clicking a row opens the detail modal: the product being inspected, plus
  // which of its photos the big preview is showing.
  const [viewing, setViewing] = useState(null);
  const [imageIndex, setImageIndex] = useState(0);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setPending(await fetchPendingItems(token));
    } catch (error) {
      toast.error(error.message || "Could not load pending items");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const fillPriceInputs = (product) => {
    setPriceInput(String(product.price ?? ""));
    setOriginalPriceInput(
      product.originalPrice == null ? "" : String(product.originalPrice),
    );
  };

  const startEditPrice = (product) => {
    setEditing(product.id);
    fillPriceInputs(product);
  };

  const cancelEditPrice = () => setEditing(null);

  const openProduct = (product) => {
    // The inline row editor and the modal write to the same two inputs, so a row
    // that's mid-edit keeps its form instead of being replaced by the modal.
    if (editing === product.id) return;
    setEditing(null);
    fillPriceInputs(product);
    setImageIndex(0);
    setViewing(product);
  };

  const handleSavePrice = async (id) => {
    const price = Number(priceInput);
    if (priceInput === "" || !Number.isFinite(price) || price < 0) {
      toast.error("Enter a valid price");
      return;
    }
    const originalPrice =
      originalPriceInput === "" ? null : Number(originalPriceInput);
    if (
      originalPrice !== null &&
      (!Number.isFinite(originalPrice) || originalPrice < 0)
    ) {
      toast.error("Enter a valid old price");
      return;
    }

    const prices = { price };
    if (originalPrice !== null) prices.originalPrice = originalPrice;

    setSavingPrice(true);
    try {
      await updateProductPrice(id, prices, token);
      // Patch the row in place — the queue isn't reloaded after a save, so
      // without this the table would still show the scraped price.
      setPending((prev) => ({
        ...prev,
        products: prev.products.map((p) =>
          p.id === id ? { ...p, ...prices } : p,
        ),
      }));
      setViewing((prev) =>
        prev && prev.id === id ? { ...prev, ...prices } : prev,
      );
      setEditing(null);
      toast.success("Price updated. Approve to publish it.");
    } catch (error) {
      toast.error(error.message || "Could not update price");
    } finally {
      setSavingPrice(false);
    }
  };

  const handleApproveProduct = async (id) => {
    setBusy(id);
    try {
      await approveProduct(id, token);
      setApproved((prev) => new Set(prev).add(id));
      await refreshData();
      toast.success("Product approved.");
    } catch (error) {
      toast.error(error.message || "Approve failed");
    } finally {
      setBusy(null);
    }
  };

  // Permanent — the backend also writes a tombstone so no rescrape can restore
  // it. Lets the admin reject a scraped product straight from the queue
  // instead of approving it, navigating to its page, then deleting it there.
  const handleDeleteProduct = async (product) => {
    if (
      !window.confirm(
        `Permanently delete "${product.name}"?\n\nThis cannot be undone — the product is removed from the database and will never be re-added by a future scrape.`,
      )
    )
      return;

    setBusy(product.id);
    try {
      await deleteProduct(product.id, token);
      setPending((prev) => ({
        ...prev,
        products: prev.products.filter((p) => p.id !== product.id),
      }));
      if (editing === product.id) setEditing(null);
      if (viewing?.id === product.id) setViewing(null);
      toast.success("Product deleted permanently.");
    } catch (error) {
      toast.error(error.message || "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  const handleApproveBanner = async (id) => {
    setBusy(id);
    try {
      await approveBanner(id, token);
      setApproved((prev) => new Set(prev).add(id));
      await refreshData();
      toast.success("Banner approved.");
    } catch (error) {
      toast.error(error.message || "Approve failed");
    } finally {
      setBusy(null);
    }
  };

  // Display-only slices. Approve, price edits and the detail modal all still
  // work off the full `pending` lists exactly as before; the tables just render
  // one page of them at a time.
  const productPager = usePagination(pending.products);
  const bannerPager = usePagination(pending.banners);

  // The modal's price fields are always live, so "has the admin touched them?"
  // is what gates Approve there — the row editor uses `editing` for the same job.
  const priceDirty =
    !!viewing &&
    (priceInput !== String(viewing.price ?? "") ||
      originalPriceInput !==
      (viewing.originalPrice == null ? "" : String(viewing.originalPrice)));

  return (
    <>
      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="panel-chip">
              <PackagePlus size={18} />
            </span>
            <div>
              <h1 className="panel-title">Upcoming Products</h1>
              <p className="panel-sub">
                Newly scraped items are hidden from shoppers until you approve
                them here.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="btn-secondary cursor-pointer gap-1.5 text-xs disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </section>

      <QueueSection
        title="New Products"
        count={pending.products.length}
        footer={
          !loading && (
            <Pagination
              page={productPager.page}
              pageCount={productPager.pageCount}
              total={productPager.total}
              from={productPager.from}
              to={productPager.to}
              onChange={productPager.setPage}
              label="products"
            />
          )
        }
      >
        {/* min-h keeps the panel from collapsing between loads. The 50vh max
           height that used to sit here is gone: pagination is what caps the
           table now, so the rows no longer scroll inside their own box AND
           page underneath it. */}
        <div className="min-h-[50vh] scroller">
          <table className="panel-table min-w-160">
            {/* No longer sticky: the header pinned itself to the 50vh scroll box
                that used to wrap this table, and that box is gone. */}
            <thead>
              <tr>
                <th>Image</th>
                <th>Name</th>
                {/* <th>Goes to</th> */}
                <th>Price</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            {/* Keyed on the page so React remounts the rows and the fade-in in
                globals.css replays on every page change. */}
            <tbody key={productPager.page} className="table-page-enter">
              {loading && (
                <tr>
                  <td colSpan={4} className="panel-muted p-6 text-center">
                    <div className="flex items-center justify-center">
                      <Loader2 size={24} className="animate-spin" />
                    </div>
                  </td>
                </tr>
              )}

              {!loading && pending.products.length === 0 && (
                <tr>
                  <td colSpan={4} className="panel-muted p-6 text-center">
                    No products waiting for approval.
                  </td>
                </tr>
              )}
              {!loading &&
                productPager.pageItems.map((p) => (
                  // The whole row opens the detail modal; the buttons inside it
                  // stop propagation so they still do their own job.
                  <tr
                    key={p.id}
                    tabIndex={0}
                    onClick={() => openProduct(p)}
                    onKeyDown={(event) => {
                      // Only when the row itself has focus — otherwise Enter
                      // inside the inline price inputs would be swallowed here.
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openProduct(p);
                      }
                    }}
                    className="cursor-pointer outline-none focus-visible:bg-[var(--panel-row-hover)]"
                  >
                    <td>
                      <div className="relative h-12 w-12 overflow-hidden rounded bg-white">
                        {p.images?.[0] && (
                          <Image
                            src={p.images[0]}
                            alt={p.name || "Product"}
                            fill
                            unoptimized
                            className="object-contain"
                          />
                        )}
                      </div>
                    </td>
                    <td>
                      <p className="panel-strong line-clamp-2 font-medium">{p.name}</p>
                      <p className="panel-muted text-xs">{p.id}</p>
                    </td>

                    <td className="whitespace-nowrap">
                      {editing === p.id ? (
                        <div className="flex items-end gap-2">
                          <div className="flex flex-col gap-1">
                            <label
                              htmlFor={`price-${p.id}`}
                              className="panel-muted text-[10px] uppercase tracking-wide"
                            >
                              Price (EUR)
                            </label>
                            <input
                              id={`price-${p.id}`}
                              type="number"
                              min="0"
                              step="0.01"
                              autoFocus
                              value={priceInput}
                              onChange={(e) => setPriceInput(e.target.value)}
                              className="input-field w-24! px-2! py-1!"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label
                              htmlFor={`original-price-${p.id}`}
                              className="panel-muted text-[10px] uppercase tracking-wide"
                            >
                              Old price
                            </label>
                            <input
                              id={`original-price-${p.id}`}
                              type="number"
                              min="0"
                              step="0.01"
                              value={originalPriceInput}
                              onChange={(e) => setOriginalPriceInput(e.target.value)}
                              className="input-field w-24! px-2! py-1!"
                            />
                          </div>
                          <div className="flex items-center gap-1 pb-0.5">
                            <button
                              type="button"
                              onClick={() => handleSavePrice(p.id)}
                              disabled={savingPrice}
                              className="btn-primary cursor-pointer gap-1 text-xs whitespace-nowrap disabled:opacity-50"
                            >
                              <Check size={13} />
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditPrice}
                              disabled={savingPrice}
                              className="btn-secondary cursor-pointer gap-1 text-xs whitespace-nowrap disabled:opacity-50"
                              aria-label="Cancel price edit"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col">
                            <span className="panel-strong font-semibold">
                              EUR {Number(p.price ?? 0).toFixed(2)}
                            </span>
                            {p.originalPrice > 0 && p.originalPrice !== p.price && (
                              <span className="panel-muted text-xs line-through">
                                EUR {Number(p.originalPrice).toFixed(2)}
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              startEditPrice(p);
                            }}
                            className="btn-icon h-8! w-8! shrink-0"
                            title="Edit price"
                            aria-label={`Edit price for ${p.name || p.id}`}
                          >
                            <Pencil size={16} />
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleApproveProduct(p.id);
                          }}
                          disabled={
                            busy === p.id || approved.has(p.id) || editing === p.id
                          }
                          title={
                            editing === p.id
                              ? "Save or cancel the price first"
                              : undefined
                          }
                          className="btn-primary cursor-pointer gap-1 text-xs whitespace-nowrap disabled:opacity-50"
                        >
                          <Check size={13} />
                          {approved.has(p.id) ? "Approved" : "Approve"}
                        </button>

                        {approved.has(p.id) && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              router.push(`/product/${p.id}`);
                            }}
                            className="btn-secondary cursor-pointer gap-1 text-xs whitespace-nowrap"
                          >
                            <ArrowUpRight size={13} />
                            Navigate
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteProduct(p);
                          }}
                          disabled={busy === p.id || editing === p.id}
                          title="Delete this product permanently"
                          aria-label={`Delete ${p.name || p.id}`}
                          className="btn-icon h-8! w-8! shrink-0 cursor-pointer hover:text-red-600 disabled:opacity-50 dark:hover:text-red-500"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </QueueSection>

      <QueueSection
        title="New Banners"
        count={pending.banners.length}
        footer={
          !loading && (
            <Pagination
              page={bannerPager.page}
              pageCount={bannerPager.pageCount}
              total={bannerPager.total}
              from={bannerPager.from}
              to={bannerPager.to}
              onChange={bannerPager.setPage}
              label="banners"
            />
          )
        }
      >
        <table className="panel-table min-w-160">
          <thead>
            <tr>
              <th>Preview</th>
              <th>Link</th>
              <th>Order</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          {/* Keyed on the page so React remounts the rows and the fade-in in
              globals.css replays on every page change. */}
          <tbody key={bannerPager.page} className="table-page-enter">
            {loading && (
              <tr>
                <td colSpan={4} className="panel-muted p-6 text-center">
                  <div className="flex items-center justify-center">
                    <Loader2 size={24} className="animate-spin" />
                  </div>
                </td>
              </tr>
            )}
            {!loading && pending.banners.length === 0 && (
              <tr>
                <td colSpan={4} className="panel-muted p-6 text-center">
                  No banners waiting for approval.
                </td>
              </tr>
            )}
            {!loading &&
              bannerPager.pageItems.map((b) => (
                <tr key={b._id}>
                  <td>
                    <div className="relative h-12 w-28 overflow-hidden rounded bg-white">
                      <Image
                        src={b.image}
                        alt={b.alt || "Banner"}
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    </div>
                  </td>
                  <td>
                    <p className="panel-muted line-clamp-1 max-w-100 text-xs">
                      {b.link || "—"}
                    </p>
                  </td>
                  <td className="panel-muted">{b.order}</td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleApproveBanner(b._id)}
                        disabled={busy === b._id || approved.has(b._id)}
                        className="btn-primary cursor-pointer gap-1 text-xs whitespace-nowrap disabled:opacity-50"
                      >
                        <Check size={13} />
                        {approved.has(b._id) ? "Approved" : "Approve"}
                      </button>
                      {approved.has(b._id) && (
                        <button
                          type="button"
                          onClick={() => router.push("/")}
                          className="btn-secondary cursor-pointer gap-1 text-xs whitespace-nowrap"
                        >
                          <ArrowUpRight size={13} />
                          Navigate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </QueueSection>

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title="Product details"
        maxWidth="max-w-4xl"
      >
        {viewing && (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-3">
              <ProductImage
                src={viewing.images?.[imageIndex]}
                alt={viewing.name || "Product"}
                variant="full"
                sizes="(max-width: 768px) 90vw, 40vw"
                className="panel-box aspect-square w-full bg-white!"
                imageClassName="object-contain p-4"
              />

              {viewing.images?.length > 1 && (
                <div className="scroller flex gap-2 overflow-x-auto pb-1">
                  {viewing.images.map((img, index) => (
                    <button
                      key={img}
                      type="button"
                      onClick={() => setImageIndex(index)}
                      aria-label={`Show photo ${index + 1}`}
                      className={`h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded border transition-all duration-200 ${index === imageIndex
                          ? "border-primary ring-2 ring-primary/40"
                          : "border-[var(--panel-border)] hover:border-primary/60"
                        }`}
                    >
                      <ProductImage
                        src={img}
                        alt=""
                        variant="thumb"
                        sizes="56px"
                        className="h-full w-full bg-white!"
                        imageClassName="object-contain p-1"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <h4 className="panel-strong text-base font-semibold wrap-break-word">
                  {viewing.name}
                </h4>
                <p className="panel-muted mt-0.5 font-mono text-xs">{viewing.id}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    approved.has(viewing.id) ? "badge-verified" : "badge-new"
                  }
                >
                  {approved.has(viewing.id) ? "Approved" : "Awaiting approval"}
                </span>
                <span
                  className={
                    viewing.stock > 0 ? "badge-in-stock" : "badge-out-stock"
                  }
                >
                  {viewing.stock > 0
                    ? `In stock (${viewing.stock})`
                    : "Out of stock"}
                </span>
                {viewing.priceOverridden && (
                  <span className="badge bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-200">
                    Price edited
                  </span>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <DetailField label="Brand" value={viewing.brand} />
                <DetailField label="Manufacturer" value={viewing.manufacturer} />
                <DetailField label="Product code" value={viewing.productCode} />
                <DetailField
                  label="Rating"
                  value={`${Number(viewing.rating ?? 0).toFixed(1)} (${viewing.reviewCount ?? 0})`}
                />
              </dl>

              <div>
                <p className="panel-muted mb-1 text-[10px] uppercase tracking-wide">
                  Goes to
                </p>
                <ProductDestinations product={viewing} categories={categories} />
              </div>

              {viewing.description && (
                <p className="panel-muted line-clamp-4 text-sm">{viewing.description}</p>
              )}

              {viewing.url && (
                <a
                  href={viewing.url}
                  target="_blank"
                  rel="noreferrer"
                  className="panel-muted inline-flex w-fit items-center gap-1 text-xs transition-colors hover:text-primary-dark hover:underline dark:hover:text-primary"
                >
                  <ExternalLink size={12} />
                  Open on the supplier site
                </a>
              )}

              <div className="panel-box space-y-3 p-3">
                <p className="panel-strong text-sm font-semibold">Pricing</p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="modal-price"
                      className="panel-muted text-[10px] uppercase tracking-wide"
                    >
                      Price (EUR)
                    </label>
                    <input
                      id="modal-price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={priceInput}
                      onChange={(e) => setPriceInput(e.target.value)}
                      className="input-field w-28! px-2! py-1!"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="modal-original-price"
                      className="panel-muted text-[10px] uppercase tracking-wide"
                    >
                      Old price
                    </label>
                    <input
                      id="modal-original-price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={originalPriceInput}
                      onChange={(e) => setOriginalPriceInput(e.target.value)}
                      className="input-field w-28! px-2! py-1!"
                    />
                  </div>
                  <div className="flex items-center gap-2 pb-0.5">
                    <button
                      type="button"
                      onClick={() => handleSavePrice(viewing.id)}
                      disabled={savingPrice || !priceDirty}
                      className="btn-primary cursor-pointer gap-1 text-xs whitespace-nowrap"
                    >
                      <Check size={13} />
                      {savingPrice ? "Saving…" : "Save price"}
                    </button>
                    {priceDirty && (
                      <button
                        type="button"
                        onClick={() => fillPriceInputs(viewing)}
                        disabled={savingPrice}
                        className="btn-secondary cursor-pointer gap-1 text-xs whitespace-nowrap"
                      >
                        <X size={13} />
                        Undo
                      </button>
                    )}
                  </div>
                </div>
                <p className="panel-muted text-xs">
                  Saved as EUR {Number(viewing.price ?? 0).toFixed(2)}
                  {viewing.originalPrice > 0 &&
                    viewing.originalPrice !== viewing.price &&
                    `, was EUR ${Number(viewing.originalPrice).toFixed(2)}`}
                  . Approve to publish it.
                </p>
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t panel-divider pt-3">
                <button
                  type="button"
                  onClick={() => handleDeleteProduct(viewing)}
                  disabled={busy === viewing.id}
                  className="btn-secondary cursor-pointer gap-1 text-xs whitespace-nowrap hover:text-red-600 disabled:opacity-50 dark:hover:text-red-500"
                >
                  <Trash2 size={13} />
                  Delete
                </button>
                {approved.has(viewing.id) && (
                  <button
                    type="button"
                    onClick={() => {
                      setViewing(null);
                      router.push(`/product/${viewing.id}`);
                    }}
                    className="btn-secondary cursor-pointer gap-1 text-xs whitespace-nowrap"
                  >
                    <ArrowUpRight size={13} />
                    Navigate
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleApproveProduct(viewing.id)}
                  disabled={
                    busy === viewing.id || approved.has(viewing.id) || priceDirty
                  }
                  title={priceDirty ? "Save or undo the price first" : undefined}
                  className="btn-primary cursor-pointer gap-1 text-xs whitespace-nowrap"
                >
                  <Check size={13} />
                  {approved.has(viewing.id)
                    ? "Approved"
                    : busy === viewing.id
                      ? "Approving…"
                      : "Approve"}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}