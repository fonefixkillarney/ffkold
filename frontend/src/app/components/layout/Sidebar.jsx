"use client";

import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import Drawer from "@/app/components/ui/Drawer";
import { useData } from "@/context/DataContext";
import { useSidebar } from "@/context/SidebarContext";
import {
  hasBranch,
  joinCategoryPath,
  nodeHref,
  readCategoryPathParam,
  resolveCategoryChain,
} from "@/lib/categoryPath";

// Shared look for every expand/collapse toggle (level 1 and below) so they read
// as one consistent control instead of a different button style per level.
const TOGGLE_BTN_CLASS =
  "shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:text-primary-dark hover:border-primary hover:bg-primary-light active:scale-90 transition-all duration-200";

// Neon-blue interaction styles live in globals.css: .sidebar-neon* for hover
// glow + click "smoke" puff, and .border-beam for the rotating border light on
// the currently active button.
const ACTIVE_CLASS = "sidebar-neon border-beam font-semibold";
const INACTIVE_CLASS = "sidebar-neon text-gray-700 dark:text-gray-300";

// The tree is six levels deep, so rows can't keep indenting by a fixed step
// forever — a level-6 label would have no width left in a 240px column. Level 2
// sits flush with the category, and every level below it adds one small step up
// to a cap.
const CHILD_LIST_CLASS = (depth) =>
  depth === 2 ? "pb-2 px-2.5 space-y-1" : "pl-3 py-1 space-y-1";

const NODE_LINK_CLASS = (depth) =>
  depth === 2 ? "px-3 py-2 text-sm" : "px-2.5 py-1.5 text-[13px]";

// Keeps a matching node's ancestors visible so you can still see where it lives;
// once a node matches, everything under it is kept so you can browse from there.
function filterNode(node, q, ancestorMatch = false) {
  const label = (node.label ?? node.name ?? "").toLowerCase();
  const selfMatch = ancestorMatch || label.includes(q);
  const items = (node.items || [])
    .map((child) => filterNode(child, q, selfMatch))
    .filter(Boolean);
  if (selfMatch || items.length) return { ...node, items };
  return null;
}

// Every node path present in a (filtered) tree — used to expand the whole result
// set while a search is active.
function collectPaths(nodes, parentSlugs, into) {
  for (const node of nodes) {
    const slugs = [...parentSlugs, node.slug];
    into.add(joinCategoryPath(slugs));
    collectPaths(node.items || [], slugs, into);
  }
  return into;
}

// One row of the tree plus its collapsible children, at any depth. Level 1 is
// rendered by the list below (it owns the section headings and the bolder type);
// this handles level 2 downward, calling itself for each deeper level.
function CategoryNode({
  node,
  parentSlugs,
  depth,
  activePath,
  openNodes,
  toggleNode,
  onNavigate,
}) {
  const slugs = [...parentSlugs, node.slug];
  const path = joinCategoryPath(slugs);
  const children = node.items || [];
  const branch = hasBranch(children);
  const isOpen = openNodes.has(path);

  // The row for the node currently being viewed stays lit — unless the view is
  // actually one of its descendants, which owns the active state instead.
  const isActive = activePath === path;

  return (
    <li>
      <div className="flex items-center gap-1">
        <Link
          href={nodeHref(slugs)}
          onClick={onNavigate}
          // Deep rows are narrow enough that a long model name truncates
          // ("Mi 10T lite/10 Lite 5G/9…"), so the full label stays available.
          title={node.label}
          data-sidebar-active={isActive || undefined}
          className={`flex-1 min-w-0 truncate rounded transition-colors duration-150 ${NODE_LINK_CLASS(depth)} ${isActive ? ACTIVE_CLASS : INACTIVE_CLASS}`}
        >
          <span className="dark:text-white! text-black!">{node.label}</span>
        </Link>

        {branch && (
          <button
            type="button"
            onClick={() => toggleNode(path)}
            className={`${TOGGLE_BTN_CLASS} ${isOpen ? "rotate-90 text-primary-dark border-primary" : ""}`}
            aria-label={`Toggle ${node.label}`}
            aria-expanded={isOpen}
          >
            <ChevronRight size={16} />
          </button>
        )}
      </div>

      {branch && (
        <div
          className={`grid transition-all duration-300 ease-in-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
        >
          <ul className={`overflow-hidden ${CHILD_LIST_CLASS(depth + 1)}`}>
            {children.map((child) => (
              <CategoryNode
                key={child.slug}
                node={child}
                parentSlugs={slugs}
                depth={depth + 1}
                activePath={activePath}
                openNodes={openNodes}
                toggleNode={toggleNode}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export default function Sidebar({ children }) {
  const { isOpen, close } = useSidebar();
  const { categories } = useData();
  const [search, setSearch] = useState("");

  // Which nodes are expanded, keyed by full slug path ("mobile-cases-by-brand",
  // "mobile-cases-by-brand/apple", …). A Set — not an index — so opening one node
  // never forces another shut and, critically, nothing defaults to "the first
  // item" the way a useState(0) index does.
  const [openNodes, setOpenNodes] = useState(() => new Set());

  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The node this listing is showing, as a full slug path. Empty on any page that
  // isn't a category listing. Resolved against the tree rather than taken from the
  // URL as-is, so a link saved before the supplier renamed a model highlights the
  // same node the listing itself falls back to.
  const activePath = useMemo(() => {
    const match = pathname.match(/^\/category\/([^/]+)$/);
    if (!match) return "";
    const slug = decodeURIComponent(match[1]);
    if (slug === "all") return "";
    const chain = resolveCategoryChain(categories, [
      slug,
      ...readCategoryPathParam(searchParams),
    ]);
    return joinCategoryPath(chain.length ? chain.map((n) => n.slug) : [slug]);
  }, [categories, pathname, searchParams]);

  // Whenever the route changes, expand every ancestor of whatever is being
  // viewed. This runs on mount too, so even if the component is remounted on
  // navigation (Home <-> Category pages aren't in a shared layout) it opens the
  // right branch instead of defaulting back to the first one. It re-runs once the
  // categories arrive, since that is when activePath can first be resolved.
  useEffect(() => {
    if (!activePath) return;
    const slugs = activePath.split("/");
    // Every ancestor of the active node, plus the node itself so its own children
    // are on screen the moment you land on it.
    const wanted = slugs.map((_, i) => slugs.slice(0, i + 1).join("/"));
    setOpenNodes((prev) => {
      if (wanted.every((p) => prev.has(p))) return prev;
      const next = new Set(prev);
      for (const p of wanted) next.add(p);
      return next;
    });
  }, [activePath]);

  // The body-scroll lock that used to live here now belongs to <Drawer>, which
  // does the same pinning internally. Two independent locks writing
  // document.body.style would each snapshot the *other's* values and restore
  // garbage, so this component must not touch the body at all.
  //
  // `lg:hidden` on the panel hides it at desktop widths but cannot reach the
  // Drawer's own backdrop, and the Drawer's Escape listener and scroll lock key
  // off `open` alone — so the breakpoint has to gate `open` itself, not just the
  // panel's classes. Matches Tailwind's `lg` (64rem) exactly. Starts false so
  // the server render and the first client render agree.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem)");
    const sync = () => setIsMobile(!mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Keep the clicked/active button in view. The sidebar remounts on navigation
  // (its scroll container resets to the top), so after the route settles we
  // scroll the list back to wherever the active button is — clicking the last
  // button no longer dumps you at the top of the sidebar. `isOpen` is a
  // dependency too: on mobile the drawer is unmounted while closed, so tapping
  // the menu icon again has to re-centre the active category in the fresh list
  // rather than reopening at the top. The delay lets the expand animation
  // (300ms grid transition) finish so measurements are stable.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: activePath/isOpen are deliberate re-run triggers, not values read in the body — the effect re-measures the DOM after each of those changes.
  useEffect(() => {
    if (!categories.length) return;
    const t = setTimeout(() => {
      document
        .querySelectorAll("[data-sidebar-scroller]")
        .forEach((scroller) => {
          // Every ancestor of the current node is marked active, so take the LAST
          // one — the node actually being viewed. Centring the top-level category
          // instead would leave a level-6 model scrolled off the bottom.
          const marked = scroller.querySelectorAll(
            '[data-sidebar-active="true"]',
          );
          const active = marked[marked.length - 1];
          if (!active) return;
          const sRect = scroller.getBoundingClientRect();
          const aRect = active.getBoundingClientRect();
          const offsetTop = aRect.top - sRect.top + scroller.scrollTop;
          const fullyVisible =
            offsetTop >= scroller.scrollTop &&
            offsetTop + aRect.height <=
            scroller.scrollTop + scroller.clientHeight;
          if (!fullyVisible) {
            scroller.scrollTop = Math.max(
              0,
              offsetTop - scroller.clientHeight / 2 + aRect.height / 2,
            );
          }
        });
    }, 350);
    return () => clearTimeout(t);
  }, [categories, activePath, isOpen]);

  const toggleNode = (path) =>
    setOpenNodes((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  // Client-side filter over the whole tree, at every depth — searching "iphone 11
  // pro max" now reaches the level-4 model node, not just the series above it.
  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((cat) => filterNode(cat, q))
      .filter(Boolean)
      .map((cat) => ({ ...cat, name: cat.name ?? cat.label }));
  }, [categories, search]);

  const isSearching = search.trim().length > 0;
  // While searching, every node in the result set is expanded so the matches
  // deeper in the tree are actually on screen.
  const searchedPaths = useMemo(() => {
    if (!isSearching) return new Set();
    return collectPaths(filteredCategories, [], new Set());
  }, [filteredCategories, isSearching]);

  const effectiveOpen = useMemo(() => {
    if (!isSearching) return openNodes;
    const merged = new Set(openNodes);
    for (const p of searchedPaths) merged.add(p);
    return merged;
  }, [openNodes, searchedPaths, isSearching]);

  const searchBox = (
    <div className="px-3.5 py-3.5 border rounded-t-lg dark:border-[#37352F] border-gray-400">
      <div className="relative">
        <Search
          size={15}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search categories…"
          className="w-full bg-white dark:bg-[#37352F] border-2 border-[#37352F] rounded-md pl-9 pr-8 py-2 text-gray-800 dark:text-white focus:outline-none dark:focus:border-primary focus:border-black! text-sm transition-colors duration-200"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:hover:text-primary-dark hover:text-black cursor-pointer transition-colors"
            aria-label="Clear search"
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );

  const categoryList = (
    <div
      data-sidebar-scroller
      className="flex-1 overflow-y-auto overscroll-contain scroller border-l border-r border-b border-[#37352F] bg-gray-300 dark:bg-black"
    >
      {categories.length === 0 && (
        <p className="px-4 py-3 text-xs text-gray-400">Loading categories…</p>
      )}

      {isSearching && filteredCategories.length === 0 && (
        <p className="px-4 py-3 text-xs text-gray-400">
          No categories match “{search}”.
        </p>
      )}

      {filteredCategories.map((cat, index) => {
        const children = cat.items || [];
        const branch = hasBranch(children);
        // Lit whenever the view is anywhere inside this category, so a level-6
        // model deep in the tree still marks its top-level category on the way in.
        const isCatActive =
          activePath === cat.slug || activePath.startsWith(`${cat.slug}/`);
        const catIsOpen = effectiveOpen.has(cat.slug);

        // Titled sections, mirroring how the source site groups its products —
        // a heading row appears whenever the scraped `group` changes. `group` is
        // the source sidebar's own menu title (BIG BRANDS, ATTRACTIVE, …), and
        // the API sorts on `order`, so both the headings and the categories
        // under them come out in the supplier's sequence.
        const prevGroup = index > 0 ? filteredCategories[index - 1].group : null;
        const showHeading = !!cat.group && cat.group !== prevGroup;

        return (
          <Fragment key={cat.slug}>
            {showHeading && (
              <p className="sidebar-heading pb-3 bg-yellow-400 text-black! dark:text-black! dark:bg-primary! border-b! border-[#37352F]">
                {cat.group}
              </p>
            )}
            <div className="border-b dark:bg-black bg-gray-300 border-[#37352F] last:border-0">
              {/* ── Level 1 ── */}
              {branch ? (
                <button
                  type="button"
                  onClick={() => toggleNode(cat.slug)}
                  data-sidebar-active={isCatActive || undefined}
                  aria-expanded={catIsOpen}
                  className={`w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-bold tracking-wide transition-colors duration-150 rounded-md ${isCatActive ? ACTIVE_CLASS : INACTIVE_CLASS
                    }`}
                >
                  <span className="truncate dark:text-white text-black">{cat.name}</span>
                  <span
                    className={`border-gray-600! ${TOGGLE_BTN_CLASS} ${catIsOpen ? "rotate-180 text-black dark:border-primary" : ""}`}
                  >
                    <ChevronDown size={16} />
                  </span>
                </button>
              ) : (
                <Link
                  href={`/category/${cat.slug}`}
                  onClick={close}
                  data-sidebar-active={isCatActive || undefined}
                  className={`block w-full px-4 py-3 text-sm font-bold tracking-wide transition-colors duration-150 rounded-md ${isCatActive ? ACTIVE_CLASS : INACTIVE_CLASS
                    }`}
                >
                  <span className="text-black dark:text-white">{cat.name}</span>
                </Link>
              )}

              {/* ── Levels 2 and below, to whatever depth the supplier goes ── */}
              {branch && (
                <div
                  className={`grid transition-all duration-300 ease-in-out ${catIsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                >
                  <ul className={`overflow-hidden ${CHILD_LIST_CLASS(2)}`}>
                    {children.map((sub) => (
                      <CategoryNode
                        key={sub.slug}
                        node={sub}
                        parentSlugs={[cat.slug]}
                        depth={2}
                        activePath={activePath}
                        openNodes={effectiveOpen}
                        toggleNode={toggleNode}
                        onNavigate={close}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );

  return (
    <>
      {/* ── Desktop ──
          No panel title of our own: the first row of the list is the source
          site's own first heading ("BIG BRANDS"), so a hardcoded one above it
          just printed the same words twice. */}
      <aside className="hidden lg:flex flex-col w-68 shrink-0 rounded-md dark:bg-black bg-gray-300 sticky top-0 max-h-screen overflow-y-auto">
        {searchBox}
        {categoryList}
        {children && (
          <div className="px-4 py-3 border-t border-white/10">{children}</div>
        )}
      </aside>

      {/* ── Mobile overlay ──
          <Drawer> owns the parts that used to live here: it portals itself to
          <body> (the app shell's `animate-page-enter` transform would otherwise
          become the containing block for a `position: fixed` overlay, leaving
          the drawer at the top of the document rather than the viewport once the
          page is scrolled), it locks body scroll while open, it closes on
          backdrop click and Escape, and — the reason for the swap — it stays
          mounted through the slide-out instead of blinking away.

          Only width/background/breakpoint come from here. `relative z-10 flex
          h-dvh flex-col overscroll-contain shadow-xl` is already on the panel;
          h-dvh rather than h-full because mobile browser chrome shrinks the
          visual viewport and the panel has to stay pinned top-to-bottom of what
          is actually on screen. Inside it, only `categoryList` scrolls. */}
      <Drawer
        open={isOpen && isMobile}
        onClose={close}
        label="Category menu"
        side="left"
        className="w-72 max-w-[88vw] bg-black lg:hidden"
      >
        <div className="flex items-center justify-end px-4 py-3 border-b border-white/10">
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="text-gray-300 hover:text-white transition-colors duration-150"
          >
            <X size={18} />
          </button>
        </div>
        {searchBox}
        {categoryList}
        {children && (
          <div className="px-4 py-3 border-t border-white/10">{children}</div>
        )}
      </Drawer>
    </>
  );
}
