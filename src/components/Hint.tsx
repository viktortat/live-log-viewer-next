"use client";

import type { ReactNode } from "react";

/**
 * A styled hover/focus tooltip bubble. Wraps exactly one interactive child;
 * the child keeps its own aria-label — the bubble is the visual counterpart
 * (native `title` is dropped where Hint is used, so hints never double up).
 */
export function Hint({ label, side = "top", children }: { label: string; side?: "top" | "bottom"; children: ReactNode }) {
  return (
    <span className="group/hint relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-[60] -translate-x-1/2 whitespace-nowrap rounded-[7px] bg-ink px-2 py-1 text-[10.5px] font-semibold text-white opacity-0 shadow-card transition-opacity delay-150 duration-100 group-focus-within/hint:opacity-100 group-hover/hint:opacity-100 ${
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
        }`}
      >
        {label}
      </span>
    </span>
  );
}
