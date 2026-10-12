"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import FilterBar from "@/app/components/category/FilterBar";
import ProductGrid from "@/app/components/category/ProductGrid";
import { useData } from "@/context/DataContext";

function sortProducts(list, sort) {
  return [...list].sort((a, b) => {
    switch (sort) {
      case "oldest":
        return new Date(a.createdAt) - new Date(b.createdAt);
      case "price-low":
        return a.price - b.price;
      case "price-high":
        return b.price - a.price;
      case "popularity":
        return b.reviewCount - a.reviewCount;
      case "manufacturer":
        return (a.manufacturer || "").localeCompare(b.manufacturer || "");
      case "availability":
        return (b.stock || 0) - (a.stock || 0);
      default:
        return new Date(b.createdAt) - new Date(a.createdAt);
    }
  });
}

// What the listing shows with no params in the URL. Anything still at its default
// is left out of the URL entirely, so paging on the home page reads as a plain
// `/?page=3` instead of a query string restating every control.
const DEFAULTS = { sort: "newest", perPage: 40, view: "grid", page: 1, search: "" };

const readInt = (raw, fallback) => {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export default function FeaturedProducts() {
  const { products, loading } = useData();
  const router = useRouter();
  const searchParams = useSearchParams();

  // The listing state lives in the URL rather than in component state: the page
  // you are on is then shareable, survives a reload, and — since each change is a
  // history entry — the browser's back button steps back through it.
  const sort = searchParams.get("sort") || DEFAULTS.sort;
  const perPage = readInt(searchParams.get("perPage"), DEFAULTS.perPage);
  const view = searchParams.get("view") || DEFAULTS.view;
  const page = readInt(searchParams.get("page"), DEFAULTS.page);
  const search = searchParams.get("search") || DEFAULTS.search;

  // The text being typed is local until it's submitted; the URL only ever holds
  // an applied search.
  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const navigate = (overrides) => {
    // page resets on every other change — a narrower list rarely has page 7.
    const merged = { sort, perPage, view, search, page: 1, ...overrides };
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value === "" || value == null) continue;
      if (String(value) === String(DEFAULTS[key])) continue;
      next.set(key, String(value));
    }
    const query = next.toString();
    // scroll:false because ProductGrid already scrolls the grid's top into view.
    router.push(query ? `/?${query}` : "/", { scroll: false });
  };

  const filtered = useMemo(() => {
    let list = products;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (product) =>
          (product.name || "").toLowerCase().includes(q) ||
          (product.brand || "").toLowerCase().includes(q) ||
          (product.description || "").toLowerCase().includes(q) ||
          (product.tags || []).some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    return sortProducts(list, sort);
  }, [products, search, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, totalPages);

  const applySearch = () => navigate({ search: searchInput.trim() });

  if (loading) {
    return (
      <section className="min-w-0 flex-1 p-4 animate-fade-up">
        <h2 className="section-heading">Featured Products</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-64 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="min-w-0 flex-1 p-1! md:p-3! animate-fade-up">
      <h2 className="section-heading">
        Featured Products
        <span className="ml-2 text-sm font-normal text-gray-400 dark:text-gray-500">
          ({filtered.length} products)
        </span>
      </h2>

      <FilterBar
        sort={sort}
        onSortChange={(value) => navigate({ sort: value })}
        perPage={perPage}
        onPerPageChange={(value) => navigate({ perPage: value })}
        view={view}
        onViewChange={(value) => navigate({ view: value, page: currentPage })}
        search={searchInput}
        onSearchChange={setSearchInput}
        onSearchSubmit={applySearch}
        currentPage={currentPage}
        totalPages={totalPages}
      />

      {search && (
        <button
          type="button"
          onClick={() => {
            setSearchInput("");
            navigate({ search: "" });
          }}
          className="-mt-2 mb-3 text-xs text-gray-400 btn-ghost hover:text-primary"
        >
          Clear search: &quot;{search}&quot;
        </button>
      )}

      <ProductGrid
        products={filtered}
        view={view}
        page={currentPage}
        perPage={perPage}
        onPageChange={(value) => navigate({ page: value })}
      />
    </section>
  );
}
