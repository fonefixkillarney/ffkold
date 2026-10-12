"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import FilterBar from "@/app/components/category/FilterBar";
import PriceRangeFilter from "@/app/components/category/PriceRangeFilter";
import ProductGrid from "@/app/components/category/ProductGrid";
import SubcategoryChooser from "@/app/components/category/SubcategoryChooser";
import Sidebar from "@/app/components/layout/Sidebar";
import { useData } from "@/context/DataContext";
import {
  joinCategoryPath,
  nodeHref,
  productCategoryPaths,
  productInCategoryPath,
  readCategoryPathParam,
  resolveCategoryChain,
} from "@/lib/categoryPath";
import { listingUrl, useListingScrollMemory } from "@/lib/scrollMemory";

function sortProducts(prods, sort) {
  return [...prods].sort((a, b) => {
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

export default function CategoryPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { products, categories, loading } = useData();

  const slug = params?.slug ?? "all";

  // Which node of the tree this listing shows: the route's category plus however
  // many slugs deep the URL goes. Replaces the old fixed item/sub pair, since the
  // supplier's tree runs to six levels — readCategoryPathParam still accepts the
  // old two-param links so nothing shared before this breaks.
  const urlPathSlugs = useMemo(
    () => readCategoryPathParam(searchParams),
    [searchParams],
  );
  const urlSearch = searchParams.get("search") || "";
  const urlSort = searchParams.get("sort") || "newest";
  const urlPage = parseInt(searchParams.get("page") || "1", 10);
  const urlPerPage = parseInt(searchParams.get("perPage") || "40", 10);
  const urlView = searchParams.get("view") || "grid";
  const urlMin = searchParams.get("minPrice") || "";
  const urlMax = searchParams.get("maxPrice") || "";

  const [searchInput, setSearchInput] = useState(urlSearch);
  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);

  // Remember how far down this exact view (slug + filters + page) the shopper
  // got, so the product page's Back link can return them to the same spot.
  useListingScrollMemory(listingUrl(`/category/${slug}`, searchParams.toString()), !loading);

  const navigate = (overrides) => {
    const merged = {
      path: urlPathSlugs.join("/"),
      search: urlSearch,
      sort: urlSort,
      page: 1,
      perPage: urlPerPage,
      view: urlView,
      minPrice: urlMin,
      maxPrice: urlMax,
      ...overrides,
    };
    const sp = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v !== "" && v != null) sp.set(k, String(v));
    });
    router.push(`/category/${slug}?${sp.toString()}`, { scroll: false });
  };

  // Every node from the top-level category down to the one being viewed. A chain
  // shorter than the URL asked for means the tail is gone (a bookmark from before
  // the supplier renamed or dropped a model), so the deepest node that still
  // resolves is what gets shown rather than an empty page.
  const chain = useMemo(
    () =>
      slug === "all" ? [] : resolveCategoryChain(categories, [slug, ...urlPathSlugs]),
    [categories, slug, urlPathSlugs],
  );
  const currentNode = chain[chain.length - 1] ?? null;
  // Slugs of the node actually resolved — the filter and the chooser row have to
  // agree with the breadcrumb, not with a stale URL.
  const activeSlugs = useMemo(
    () => (chain.length ? chain.map((n) => n.slug) : slug === "all" ? [] : [slug]),
    [chain, slug],
  );
  const activePath = useMemo(() => joinCategoryPath(activeSlugs), [activeSlugs]);

  // Products anywhere in the top-level category, which is the range the price
  // slider calibrates itself against (it shouldn't rescale on every drill-down).
  const poolForSlug = useMemo(
    () =>
      slug === "all"
        ? products
        : products.filter((p) => productInCategoryPath(p, slug)),
    [products, slug],
  );

  const filtered = useMemo(() => {
    // A node matches its own products AND everything filed under its descendants,
    // so "iPhone 11 Series" keeps listing all 3 models' cases while "iPhone 11 Pro
    // Max (6.5)" narrows to just that one.
    let list = products.filter((p) => productInCategoryPath(p, activePath));
    if (urlSearch)
      list = list.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(urlSearch.toLowerCase()) ||
          (p.brand || "").toLowerCase().includes(urlSearch.toLowerCase()),
      );
    if (urlMin !== "") list = list.filter((p) => p.price >= parseFloat(urlMin));
    if (urlMax !== "" && urlMax !== "Infinity")
      list = list.filter((p) => p.price <= parseFloat(urlMax));
    return sortProducts(list, urlSort);
  }, [products, activePath, urlSearch, urlMin, urlMax, urlSort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / urlPerPage));

  // How many products each child node holds, so the chooser row can label its
  // buttons. One pass over the catalogue that buckets each product by the child it
  // falls under — a per-child filter would re-walk every product once per button,
  // and some nodes have thirty of them.
  const childCounts = useMemo(() => {
    const children = currentNode?.items ?? [];
    if (!children.length) return null;
    const counts = new Map(children.map((c) => [c.slug, 0]));
    const depth = activeSlugs.length;
    for (const product of products) {
      // A product cross-listed under two of these children counts once for each,
      // but never twice for the same one.
      const counted = new Set();
      for (const path of productCategoryPaths(product)) {
        const segs = path.split("/");
        if (segs.length <= depth) continue;
        if (activeSlugs.some((slugPart, i) => segs[i] !== slugPart)) continue;
        const childSlug = segs[depth];
        if (!counts.has(childSlug) || counted.has(childSlug)) continue;
        counted.add(childSlug);
        counts.set(childSlug, counts.get(childSlug) + 1);
      }
    }
    return counts;
  }, [products, currentNode, activeSlugs]);

  const handlePriceChange = (min, max) => {
    navigate({
      minPrice: min === 0 ? "" : min,
      maxPrice: max === Infinity ? "" : max,
      page: 1,
    });
  };

  return (
    <div className="glass-shell container-main py-5">
      <div className="flex min-h-screen">
        <Sidebar>
          <PriceRangeFilter
            products={poolForSlug}
            minPrice={urlMin}
            maxPrice={urlMax}
            onChange={handlePriceChange}
          />
        </Sidebar>

        <div className="flex-1 min-w-0 py-4 lg:p-4">
          <nav className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-4 flex-wrap">
            <Link href="/" className="hover:text-black dark:hover:text-primary">
              Home
            </Link>
            {slug === "all" ? (
              <>
                <ChevronRight size={12} />
                <span className="text-gray-800 dark:text-gray-100">All Products</span>
              </>
            ) : (
              // One crumb per level, so a level-6 model shows the whole route in
              // to it — every crumb but the last is a link back up the tree.
              chain.map((node, i) => {
                const isLast = i === chain.length - 1;
                return (
                  <span key={node.slug} className="flex items-center gap-1">
                    <ChevronRight size={12} />
                    {isLast ? (
                      <span className="text-gray-800 dark:text-gray-100">
                        {node.label}
                      </span>
                    ) : (
                      <Link
                        href={nodeHref(activeSlugs.slice(0, i + 1))}
                        className="hover:text-black dark:hover:text-primary"
                      >
                        {node.label}
                      </Link>
                    )}
                  </span>
                );
              })
            )}
          </nav>

          <h2 className="section-heading">
            {urlSearch
              ? `Search results for "${urlSearch}"`
              : (currentNode?.label ??
                (slug === "all" ? "All Products" : slug.replace(/-+/g, " ")))}
            <span className="text-sm font-normal text-gray-400 dark:text-gray-500 ml-2">
              ({loading ? "…" : filtered.length} products)
            </span>
          </h2>

          {!urlSearch && (
            <SubcategoryChooser
              pathSlugs={activeSlugs}
              items={currentNode?.items}
              countFor={(item) => childCounts?.get(item.slug)}
            />
          )}

          <FilterBar
            sort={urlSort}
            onSortChange={(v) => navigate({ sort: v, page: 1 })}
            perPage={urlPerPage}
            onPerPageChange={(v) => navigate({ perPage: v, page: 1 })}
            view={urlView}
            onViewChange={(v) => navigate({ view: v })}
            search={searchInput}
            onSearchChange={setSearchInput}
            onSearchSubmit={() => navigate({ search: searchInput, page: 1 })}
            currentPage={urlPage}
            totalPages={totalPages}
          />
          {urlSearch && (
            <button
              onClick={() => {
                setSearchInput("");
                navigate({ search: "", page: 1 });
              }}
              className="btn-ghost text-xs cursor-pointer mb-3 -mt-2 text-gray-400 hover:text-black dark:text-gray-500 dark:hover:text-primary"
            >
              ✕ Clear search: &quot;{urlSearch}&quot;
            </button>
          )}

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-64 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse"
                />
              ))}
            </div>
          ) : (
            // ProductGrid scrolls itself back to the top of the grid on a page
            // change — this only has to update the URL.
            <ProductGrid
              products={filtered}
              view={urlView}
              page={urlPage}
              perPage={urlPerPage}
              onPageChange={(p) => navigate({ page: p })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
