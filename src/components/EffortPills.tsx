import type { FileEntry } from "@/lib/types";

import { EFFORT_LEVEL_MAX, effortLevel, effortTint, effortTitle } from "./utils";

/**
 * Six slim vertical pills next to a model chip, filled up to the entry's
 * reasoning-effort level (minimal=1 through max=6). The filled bars carry the same
 * effort-shifted tint as the chip so the two read as one identity unit; empty
 * slots stay faint. Renders nothing when no reliable effort exists, keeping the
 * chip exactly as it looks today. The tier reads out through the shared
 * `util.effortTitle` tooltip with no visible label.
 */
export function EffortPills({ file }: { file: FileEntry }) {
  const level = effortLevel(file);
  if (!level) return null;
  const { color } = effortTint(file);
  const title = effortTitle(file);
  return (
    <span
      className="inline-flex shrink-0 items-end gap-[1.5px]"
      role="img"
      aria-label={title}
      title={title}
    >
      {Array.from({ length: EFFORT_LEVEL_MAX }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="w-[2px] rounded-full"
          style={{
            height: `${5 + i}px`,
            backgroundColor: i < level ? color : "var(--color-line, #e6e6ea)",
          }}
        />
      ))}
    </span>
  );
}
