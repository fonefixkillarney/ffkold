"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

// Client-side pagination for the dashboard tables. Purely presentational: it
// slices an already-loaded array, so no filter, sort, status change or delete
// behaves any differently — the same rows are simply shown a page at a time.

export const DEFAULT_PAGE_SIZE = 8;

// Which page numbers to render, with "…" standing in for the runs we skip.
// Always shows first, last, and a window around the current page, so the bar's
// width stays fixed no matter how many orders there are.
function pageList(page, pageCount) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const pages = new Set([1, pageCount, page, page - 1, page + 1]);
  // Keep the bar the same width at the ends, where the window is one-sided.
  if (page <= 3) {
    pages.add(2).add(3).add(4);
  }
  if (page >= pageCount - 2) {
    pages.add(pageCount - 1).add(pageCount - 2).add(pageCount - 3);
  }
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);

  const out = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push(`gap-${p}`);
    out.push(p);
    previous = p;
  }
  return out;
}

// Slices `items` and keeps the current page honest when the list changes under
// it — deleting the last order on page 4, or switching to a filter with fewer
// matches, lands you on the last page that still exists rather than on a blank
// one.
export function usePagination(items, perPage = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(page, pageCount);

  useEffect(() => {
    if (page !== current) setPage(current);
  }, [page, current]);

  const start = (current - 1) * perPage;
  const pageItems = useMemo(
    () => items.slice(start, start + perPage),
    [items, start, perPage],
  );

  return {
    page: current,
    setPage,
    pageCount,
    perPage,
    total,
    // 1-based inclusive range, for the "Showing 1–8 of 24" line.
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + perPage, total),
    pageItems,
  };
}

export default function Pagination({
  page,
  pageCount,
  total,
  from,
  to,
  onChange,
  label = "rows",
}) {
  // One page of results needs no controls — the count line alone would just be
  // chrome around a number the table already makes obvious.
  if (pageCount <= 1) return null;

  const go = (next) => {
    const clamped = Math.min(Math.max(next, 1), pageCount);
    if (clamped !== page) onChange(clamped);
  };

  return (
    <div className="pager-bar">
      <p className="pager-info">
        Showing {from}–{to} of {total} {label}
      </p>

      <div className="pager-controls">
        <button
          type="button"
          className="pager-btn"
          onClick={() => go(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
        </button>

        {pageList(page, pageCount).map((entry) =>
          typeof entry === "number" ? (
            <button
              key={entry}
              type="button"
              onClick={() => go(entry)}
              aria-current={entry === page ? "page" : undefined}
              aria-label={`Page ${entry}`}
              className={`pager-btn ${entry === page ? "pager-btn-active" : ""}`}
            >
              {entry}
            </button>
          ) : (
            <span key={entry} className="pager-gap" aria-hidden="true">
              …
            </span>
          ),
        )}

        <button
          type="button"
          className="pager-btn"
          onClick={() => go(page + 1)}
          disabled={page === pageCount}
          aria-label="Next page"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
