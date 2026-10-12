"use client";

import { ArrowLeft, ChevronRight, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Sidebar from "@/app/components/layout/Sidebar";
import ImageGallery from "@/app/components/product/ImageGallery";
import ProductInfo from "@/app/components/product/ProductInfo";
import RelatedProducts from "@/app/components/product/RelatedProducts";
import Modal from "@/app/components/ui/Modal";
import { useAuth } from "@/context/AuthContext";
import { useData } from "@/context/DataContext";
import { deleteProduct, fetchProduct } from "@/lib/api";
import {
  productCategoryPaths,
  readCategoryPathParam,
  resolveCategoryChain,
} from "@/lib/categoryPath";
import { canGoBack, readPreviousPage } from "@/lib/navHistory";
import { readLastListing, requestListingRestore } from "@/lib/scrollMemory";

function describePage(url, categories) {
  if (!url) return null;
  const [path, query] = url.split("?");
  const params = new URLSearchParams(query ?? "");

  if (path === "/") return "Home";
  if (path === "/wishlist") return "Wishlist";
  if (path === "/cart") return "Cart";
  if (path.startsWith("/product/")) return "Previous Product";
  if (path.startsWith("/category/")) {
    const search = params.get("search");
    if (search) return `Search “${search}”`;
    const slug = path.slice("/category/".length);
    if (slug === "all") return "All Products";

    const chain = resolveCategoryChain(categories, [
      slug,
      ...readCategoryPathParam(params),
    ]);
    return chain[chain.length - 1]?.label ?? slug.replace(/-+/g, " ");
  }
  return null;
}

export default function ProductPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id ?? "";
  const { products, categories, loading, removeProductLocal } = useData();
  const { token, isAdmin } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const listed = loading ? null : products.find((p) => p.id === id);
  const [fetched, setFetched] = useState(null); // null = still in flight
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setFetched(null);
    fetchProduct(id, token)
      .then((data) => {
        if (!cancelled) setFetched({ data });
      })
      .catch(() => {
        if (!cancelled) setFetched({ data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  const detail = fetched?.data ?? null;
  const product = useMemo(() => {
    const base = listed ?? detail;
    if (!base) return null;
    return {
      ...base,
      longDescription: base.longDescription ?? detail?.longDescription ?? "",
    };
  }, [listed, detail]);

  const [back, setBack] = useState(null);
  useEffect(() => {
    if (!product) {
      setBack(null);
      return;
    }

    const last = readLastListing();
    let listing = null;
    if (last) {
      const slug = last.url.split("?")[0].replace(/^\/category\//, "");
      const slugs = productCategoryPaths(product).map((p) => p.split("/")[0]);
      if (slug === "all" || slugs.includes(slug)) listing = { ...last, slug };
    }

    setBack({ history: canGoBack(), previous: readPreviousPage(), listing });
  }, [product]);

  if (!product) {
    // Still waiting on either source.
    if (loading || fetched === null) {
      return (
        <div className="container-main py-20 flex gap-4">
          <div className="hidden lg:block w-60 shrink-0 h-96 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
          <div className="flex-1 space-y-4">
            <div className="h-8 w-48 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            <div className="grid lg:grid-cols-2 gap-8">
              <div className="h-80 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              <div className="h-80 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="container-main py-20 text-center">
        <p className="text-5xl mb-4">🔍</p>
        <h2 className="text-2xl font-bold text-gray-700 mb-2">
          Product not found
        </h2>
        <p className="text-gray-500 mb-6">
          The product you are looking for does not exist or has been removed.
        </p>
        <Link href="/" className="btn-primary">
          Back to Home
        </Link>
      </div>
    );
  }

  const category = categories.find((c) => c.slug === product.category);

  // Permanent: the backend tombstones the id so no rescrape brings it back.
  // Leaves for the product's category, since this page has nothing left to show.
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteProduct(product.id, token);
      toast.success("Product deleted permanently.");
      router.replace(`/category/${product.category || "all"}`);
      removeProductLocal(product.id);
    } catch (error) {
      toast.error(error.message || "Delete failed");
      setDeleting(false);
    }
  };

  const backLabel =
    describePage(back?.previous, categories) ??
    (back?.listing
      ? describePage(back.listing.url, categories)
      : (category?.name ?? null));

  const backButton = back?.history ? (
    <button
      type="button"
      onClick={() => router.back()}
      className="btn-secondary mb-4 inline-flex cursor-pointer gap-1.5 text-xs"
    >
      <ArrowLeft size={14} />
      {backLabel ? `Back to ${backLabel}` : "Back"}
    </button>
  ) : (
    <Link
      href={back?.listing ? back.listing.url : `/category/${product.category}`}
      scroll={!back?.listing?.y}
      onClick={() => {
        if (back?.listing?.y)
          requestListingRestore(back.listing.url, back.listing.y);
      }}
      className="btn-secondary mb-4 inline-flex cursor-pointer gap-1.5 text-xs"
    >
      <ArrowLeft size={14} />
      Back to {backLabel ?? "category"}
    </Link>
  );

  return (
    <div className="container-main">
      <div className="flex min-h-screen">
        <Sidebar />

        <div className="flex-1 min-w-0 py-4 lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            {backButton}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="btn-delete mb-4 inline-flex cursor-pointer items-center gap-1.5 text-xs"
              >
                <Trash2 size={14} />
                Delete product
              </button>
            )}
          </div>

          <Modal
            open={confirmDelete}
            onClose={() => !deleting && setConfirmDelete(false)}
            title="Delete product?"
            maxWidth="max-w-sm"
          >
            <div className="space-y-4">
              <p className="panel-muted text-sm">
                Permanently delete <strong className="panel-strong">{product.name}</strong>? This
                cannot be undone. The product is removed from the store and no future
                scrape will add it back.
              </p>
              <div className="flex justify-end">
                <button type="button" className="btn-delete" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </Modal>

          <nav className="flex items-center gap-1 text-xs text-gray-500 mb-5 flex-wrap">
            <Link href="/" className="hover:text-primary">
              Home
            </Link>
            <ChevronRight size={12} />
            <Link
              href={`/category/${product.category}`}
              className="hover:text-primary"
            >
              {category?.name ?? product.category}
            </Link>
            <ChevronRight size={12} />
            <span className="text-gray-800 dark:text-gray-200 line-clamp-1">{product.name}</span>
          </nav>

          <div className="flex flex-col gap-8 mb-10 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_27rem]">
            <div className="flex-1 min-w-0">
              <ImageGallery images={product.images} />
            </div>
            <div className="w-full">
              <ProductInfo
                product={product}
                onUpdated={(patch) =>
                  setFetched((f) => (f?.data ? { data: { ...f.data, ...patch } } : f))
                }
              />
            </div>
          </div>

          {product.longDescription && (
            <div className="mb-8 p-5 bg-gray-200 dark:bg-primary rounded-lg border border-gray-100 dark:border-primary">
              <h3 className="mb-3 dark:text-black font-bold">Product Description</h3>
              <p className="text-sm text-gray-600 dark:text-black leading-relaxed">
                {product.longDescription}
              </p>
            </div>
          )}
          {/*
          <ReviewSection product={product} /> */}
          <RelatedProducts product={product} />
        </div>
      </div>
    </div>
  );
}
