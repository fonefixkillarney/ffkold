"use client";

import Link from "next/link";
import { nodeHref } from "@/lib/categoryPath";

// The row of child categories for whatever node the listing is showing — the
// supplier prints the same thing above its own grid as "Choose a sub category:",
// and it is the only place several of its levels are reachable at all (its
// sidebar stops three levels in, so "iPhone 11 Series" only splits into
// "iPhone 11 (6.1) / iPhone 11 Pro (5.8) / iPhone 11 Pro Max (6.5)" here).
//
// The sidebar carries the same nodes as a tree; this is the shortcut for the one
// decision a shopper on this page is actually about to make, without hunting for
// the right row in a six-level-deep list.
export default function SubcategoryChooser({ pathSlugs, items, countFor }) {
  if (!items?.length) return null;

  return (
    <section className="mb-4 rounded-lg border border-gray-300 dark:border-[#37352F] overflow-hidden">
      <h3 className="px-4 py-2 text-xs font-bold tracking-wide bg-gray-200 dark:bg-[#37352F] text-black dark:text-white">
        Choose a sub category
      </h3>
      <ul className="flex flex-wrap gap-2 p-3 bg-gray-100 dark:bg-black">
        {items.map((item) => {
          // Deliberately shown even at zero: an empty node is how a shopper sees
          // that the supplier lists nothing for that model yet, and hiding it
          // would make our menu quietly disagree with theirs.
          const count = countFor?.(item);
          return (
            <li key={item.slug}>
              <Link
                href={nodeHref([...pathSlugs, item.slug])}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-[#37352F] bg-white dark:bg-[#37352F] px-3 py-1.5 text-xs text-black dark:text-white transition-colors duration-150 hover:border-primary hover:text-primary-dark dark:hover:text-primary"
              >
                <span>{item.label}</span>
                {typeof count === "number" && (
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    ({count})
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
