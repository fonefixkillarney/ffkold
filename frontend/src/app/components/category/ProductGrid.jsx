"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";
import ProductCard from "./ProductCard";

export default function ProductGrid({
  products,
  view,
  page,
  perPage,
  onPageChange,
}) {
  const totalPages = Math.max(1, Math.ceil(products.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = products.slice(start, start + perPage);

  const rootRef = useRef(null);

  const changePage = (next) => {
    if (next === page) return;
    onPageChange(next);
    const root = rootRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top + window.scrollY;
    const headerElement = document.querySelector("header");
    const header =
      headerElement &&
      getComputedStyle(headerElement).position === "sticky"
        ? headerElement.offsetHeight
        : 0;
    window.scrollTo({ top: Math.max(0, top - header - 12) });
  };

  const pageNumbers = () => {
    const pages = [];
    const delta = 2;
    const left = Math.max(2, page - delta);
    const right = Math.min(totalPages - 1, page + delta);

    pages.push({ key: "page-1", type: "page", value: 1 });
    if (left > 2) pages.push({ key: "ellipsis-left", type: "ellipsis" });
    for (let i = left; i <= right; i++) {
      pages.push({ key: `page-${i}`, type: "page", value: i });
    }
    if (right < totalPages - 1) {
      pages.push({ key: "ellipsis-right", type: "ellipsis" });
    }
    if (totalPages > 1) {
      pages.push({
        key: `page-${totalPages}`,
        type: "page",
        value: totalPages,
      });
    }
    return pages;
  };

  if (paginated.length === 0) {
    return (
      <div className="py-16 text-center text-gray-400 dark:text-gray-500">
        <p className="mb-3 text-4xl">No results</p>
        <p className="text-lg font-medium text-gray-500 dark:text-gray-400">No products found</p>
        <p className="mt-1 text-sm">Try adjusting your search or filters</p>
      </div>
    );
  }

  return (
    <div ref={rootRef}>
      {view === "list" ? (
        <div className="flex flex-col gap-3">
          {paginated.map((product, i) => (
            <ProductCard
              key={product.id}
              product={product}
              view="list"
              style={{ animationDelay: `${Math.min(i, 14) * 40}ms` }}
            />
          ))}
        </div>
      ) : (
        // Two columns from 340px: one full-width card per row made a 40-product
        // page ~19,000px tall on a phone. ProductCard shrinks its own image,
        // type and button below sm to fit the ~160px column. Under 340px (fold
        // cover screens) a column would be too narrow for "Out of Stock".
        <div className="grid grid-cols-1 gap-3 min-[340px]:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          {paginated.map((product, i) => (
            <ProductCard
              key={product.id}
              product={product}
              view="grid"
              style={{ animationDelay: `${Math.min(i, 14) * 40}ms` }}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => changePage(Math.max(1, page - 1))}
            disabled={page === 1}
            className={page === 1 ? "page-btn-disabled" : "page-btn"}
            aria-label="Previous page"
          >
            <ChevronLeft size={15} />
          </button>

          {pageNumbers().map((pageItem) =>
            pageItem.type === "ellipsis" ? (
              <span key={pageItem.key} className="px-2 text-sm text-gray-400 dark:text-gray-500">
                ...
              </span>
            ) : (
              <button
                type="button"
                key={pageItem.key}
                onClick={() => changePage(pageItem.value)}
                className={
                  pageItem.value === page ? "page-btn-active" : "page-btn"
                }
              >
                {pageItem.value}
              </button>
            ),
          )}

          <button
            type="button"
            onClick={() => changePage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className={page === totalPages ? "page-btn-disabled" : "page-btn"}
            aria-label="Next page"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
