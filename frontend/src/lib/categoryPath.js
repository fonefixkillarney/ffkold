// The category tree runs six levels deep (the supplier's own sidebar only shows
// three; its category pages continue past that), so a listing is addressed by the
// full slug PATH of the node it shows rather than by a fixed item/sub pair.
//
// Format — root-first slugs joined with "/", matching the `path` the backend
// stores on every product's categoryTags:
//   "mobile-cases-by-brand/apple/iphone-11-series/iphone-11-6-1"

export const PATH_SEP = "/";

export const joinCategoryPath = (slugs = []) =>
  slugs.filter(Boolean).join(PATH_SEP);

export const splitCategoryPath = (path = "") =>
  String(path || "")
    .split(PATH_SEP)
    .filter(Boolean);

// The path of one categoryTag. Tags saved before the backend had a `path` field
// only carry the three legacy levels, so derive it from those — level-1
// placements were stored with subcategory === category, which collapses back to a
// single segment. Keeps every already-scraped product filterable while the next
// scrape fills in the real paths.
export function categoryTagPath(tag = {}) {
  if (tag.path) return tag.path;
  const { category = "", subcategory = "", subsubcategory = "" } = tag;
  if (!category) return "";
  const rest =
    subcategory && subcategory !== category ? [subcategory, subsubcategory] : [];
  return joinCategoryPath([category, ...rest]);
}

// Every category this product is placed under, as paths. A product is commonly
// cross-listed under several (a case sits under its brand, its model series AND
// the model itself), so membership is always checked across all of them.
export function productCategoryPaths(product = {}) {
  const tags = product.categoryTags?.length
    ? product.categoryTags
    : [
        {
          category: product.category,
          subcategory: product.subcategory,
          subsubcategory: product.subsubcategory,
        },
      ];
  return tags.map(categoryTagPath).filter(Boolean);
}

// Is `path` at, or anywhere below, node `prefix`? Compared on whole segments, so
// the node "iphone-11" never swallows its sibling "iphone-11-pro".
export function isPathUnder(path = "", prefix = "") {
  if (!prefix) return true;
  return path === prefix || path.startsWith(prefix + PATH_SEP);
}

// Does this product sit at or below the given node? `prefix` of "" means the
// whole catalogue (/category/all).
export function productInCategoryPath(product, prefix) {
  if (!prefix) return true;
  return productCategoryPaths(product).some((p) => isPathUnder(p, prefix));
}

// Walks the tree to the node addressed by `pathSlugs` (root first, including the
// top-level category slug) and returns every node along the way. A shorter chain
// than the path asked for means the tail no longer exists — a stale bookmark from
// before the supplier renamed something — and the caller falls back to the
// deepest node it did resolve.
//
// Nodes are returned in a uniform shape so breadcrumbs and child lists don't have
// to care that a top-level category names itself `name` and every node below it
// uses `label`.
export function resolveCategoryChain(categories, pathSlugs = []) {
  const chain = [];
  const [rootSlug, ...rest] = pathSlugs;
  if (!rootSlug) return chain;

  const root = (categories || []).find((c) => c.slug === rootSlug);
  if (!root) return chain;
  chain.push({ label: root.name, slug: root.slug, items: root.items || [] });

  let current = root;
  for (const slug of rest) {
    const next = (current.items || []).find((i) => i.slug === slug);
    if (!next) break;
    chain.push({ label: next.label, slug: next.slug, items: next.items || [] });
    current = next;
  }
  return chain;
}

// The listing URL for a node. The top-level category is the route segment;
// everything below it rides in one `path` param, so a level-6 model is a link like
// /category/mobile-cases-by-brand?path=other-models/xiaomi/mi/xiaomi-mi/mi-11
export function nodeHref(pathSlugs = []) {
  const [root, ...rest] = pathSlugs;
  if (!root) return "/category/all";
  if (!rest.length) return `/category/${root}`;
  return `/category/${root}?path=${rest.map(encodeURIComponent).join(PATH_SEP)}`;
}

// The slugs BELOW the category slug for the current listing, read from the URL.
// `item`/`sub` are the two-level scheme this used to use — still honoured so
// links shared or bookmarked before the deep tree existed keep working.
export function readCategoryPathParam(searchParams) {
  const path = searchParams.get("path");
  if (path) return splitCategoryPath(path);
  const item = searchParams.get("item");
  if (!item) return [];
  const sub = searchParams.get("sub");
  return sub ? [item, sub] : [item];
}

// A node whose only child leads nowhere new is not worth a level of navigation:
// the node's own page already lists everything that child holds. Kept as an
// expandable branch only when there is a real choice to make, or when that single
// child has children of its own.
export const hasBranch = (items = []) =>
  items.length > 1 || (items.length === 1 && (items[0].items || []).length > 0);
