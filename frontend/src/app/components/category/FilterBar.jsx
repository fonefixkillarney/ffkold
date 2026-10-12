"use client";

import { ChevronsUpDown, LayoutGrid, List } from "lucide-react";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "price-low", label: "Price: Low to High" },
  { value: "price-high", label: "Price: High to Low" },
  { value: "popularity", label: "Popularity" },
  { value: "manufacturer", label: "Manufacturer" },
  { value: "availability", label: "Availability" },
];

const PER_PAGE_OPTIONS = [10, 20, 30, 40, 60, 80, 100];

/* Both view buttons carry identical padding so the pair keeps one size (and the
   row keeps one height) as the selection moves between them. */
const VIEW_BTN = "cursor-pointer rounded-md p-2";
const VIEW_BTN_ACTIVE = `${VIEW_BTN} bg-black text-primary`;
const VIEW_BTN_IDLE = `${VIEW_BTN} bg-primary text-black`;

export default function FilterBar({
  sort,
  onSortChange,
  perPage,
  onPerPageChange,
  view,
  onViewChange,
  search,
  onSearchChange,
  onSearchSubmit,
  currentPage,
  totalPages,
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-gray-200! dark:border-gray-700 bg-surface dark:bg-primary p-3">
      {/* Search fills the row on phones; from sm it settles at a fixed width. */}
      <div className="flex w-full min-w-0 sm:w-82 h-10">
        <input
          type="text"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && onSearchSubmit?.()}
          placeholder="Search within..."
          className="input-field bg-gray-200 dark:bg-black min-w-0 flex-1 rounded-r-none border-r-0 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={onSearchSubmit}
          className="btn-primary shrink-0 cursor-pointer hover:bg-black! hover:text-white rounded-l-none px-3 py-1.5 text-xs"
        >
          Go
        </button>
      </div>


      <div className="flex w-full min-w-0 items-center gap-1.5 min-[360px]:w-auto min-[360px]:flex-1 sm:flex-none">
        <label
          htmlFor="product-per-page"
          className="whitespace-nowrap text-sm text-black"
        >
          Show:
        </label>
        <div className="relative h-10 min-w-0 flex-1 sm:flex-none">
          <select
            id="product-per-page"
            value={perPage}
            onChange={(event) => onPerPageChange(Number(event.target.value))}
            className="select-field w-full sm:w-20 py-1.5 pr-8 text-sm bg-gray-200 dark:bg-black"
          >
            {PER_PAGE_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
          <ChevronsUpDown
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-300"
          />
        </div>
      </div>

      <div className="flex w-full min-w-0 items-center gap-1.5 min-[360px]:w-auto min-[360px]:flex-[1.4] sm:flex-none">
        <label
          htmlFor="product-sort"
          className="whitespace-nowrap text-sm text-black"
        >
          Sort:
        </label>
        {/* .select-field is `appearance-none`, so the native dropdown marker is
            gone — this up/down chevron is the only affordance telling you the
            control opens. pointer-events-none keeps clicks going to the select. */}
        <div className="relative h-10! min-w-0 flex-1 sm:flex-none">
          <select
            id="product-sort"
            value={sort}
            onChange={(event) => onSortChange(event.target.value)}
            className="select-field w-full sm:w-40 py-1.5 pr-8 text-sm bg-gray-200 dark:bg-black"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronsUpDown
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-300"
          />
        </div>
      </div>

      {/* View toggle and page counter travel together: their own row on phones
          (toggle left, counter pushed right), tucked to the far right from sm. */}
      <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
        <div className="flex w-fit shrink-0 gap-1 border-2 border-gray-200 dark:border-black rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => onViewChange("grid")}
            className={view === "grid" ? VIEW_BTN_ACTIVE : VIEW_BTN_IDLE}
            aria-label="Grid view"
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            onClick={() => onViewChange("list")}
            className={view === "list" ? VIEW_BTN_ACTIVE : VIEW_BTN_IDLE}
            aria-label="List view"
          >
            <List size={15} />
          </button>
        </div>

        {totalPages > 0 && (
          <p className="ml-auto whitespace-nowrap text-sm text-black">
            Page {currentPage} of {totalPages}
          </p>
        )}
      </div>
    </div>
  );
}
