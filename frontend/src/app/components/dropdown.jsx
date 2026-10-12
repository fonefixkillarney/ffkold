"use client";

import React from "react";

export default function HoverDropdown({
  trigger,
  items = [],
  align = "left",
  width = "220px",
  className = "",
}) {
  const alignment =
    align === "right"
      ? "right-0"
      : align === "center"
        ? "left-1/2 -translate-x-1/2"
        : "left-0";

  return (
    <div className={`group relative inline-flex ${className}`}>
      {/* Trigger */}
      <div
        aria-haspopup="menu"
        className="cursor-pointer"
      >
        {trigger}
      </div>

      {/* Dropdown */}
      <div
        className={`
          pointer-events-none absolute ${alignment} top-full z-50
          pt-2
          opacity-0
          invisible
          translate-y-2
          scale-[0.98]
          transition-all duration-200 ease-out

          group-hover:pointer-events-auto
          group-hover:visible
          group-hover:opacity-100
          group-hover:translate-y-0
          group-hover:scale-100
        `}
        style={{ width }}
        role="menu"
      >
        <div
          className="
            overflow-hidden
            rounded-md
            border border-black/[0.08]
            bg-white
            shadow-[0_12px_35px_rgba(0,0,0,0.12)]
          "
        >
          {items.map((item, index) => {
            const Icon = item.icon;

            return (
              <button
                key={item.id ?? item.label ?? index}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={item.onClick}
                className={`
                  group/item
                  flex w-full items-center gap-4
                  rounded-lg
                  text-left
                  transition-colors duration-150

                  ${
                    item.disabled
                      ? "cursor-not-allowed opacity-40"
                      : "cursor-pointer hover:bg-black/[0.045]"
                  }
                `}
              >
                {Icon && (
                  <span
                    className="
                      flex h-9 w-9 shrink-0
                      items-center justify-center
                      rounded-lg
                      text-gray-700
                      transition-colors
                      group-hover/item:text-black
                    "
                  >
                    <Icon size={21} strokeWidth={1.8} />
                  </span>
                )}

                <span className="min-w-0">
                  <span className="block text-[15px] font-medium leading-5 text-gray-900">
                    {item.label}
                  </span>

                  {item.description && (
                    <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                      {item.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}