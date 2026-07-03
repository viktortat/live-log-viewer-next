"use client";

import type { FileEntry } from "@/lib/types";

import { fmtAge, typeInfo } from "./utils";

interface Props {
  file: FileEntry;
  active: boolean;
  depth?: number;
  flat?: boolean;
  hiddenCount?: number;
  hiddenLive?: boolean;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onSelect: (file: FileEntry) => void;
}

export function FileRow({
  file,
  active,
  depth = 0,
  flat = false,
  hiddenCount = 0,
  hiddenLive = false,
  hasChildren = false,
  expanded = false,
  onToggle,
  onSelect,
}: Props) {
  const ico = typeInfo(file);
  const activity =
    file.activity === "live" ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#e5f6ea] px-2 py-0.5 text-[10.5px] font-bold text-ok">
        <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-ok" />
        працює
      </span>
    ) : file.activity === "recent" ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf3e3] px-2 py-0.5 text-[10.5px] font-bold text-[#b07714]">
        <span className="h-[7px] w-[7px] rounded-full bg-[#b07714]" />
        закінчив
      </span>
    ) : null;
  return (
    <div
      className={[
        "group relative mb-0.5 flex cursor-pointer items-start gap-2 rounded-xl border px-2 pr-2.5 hover:bg-bg",
        ico.aux ? "py-1.5" : "py-2",
        active ? "border-line bg-panel shadow-card" : "border-transparent",
      ].join(" ")}
      style={{ paddingLeft: 8 + depth * 16 }}
      title={file.path}
      onClick={() => onSelect(file)}
    >
      {depth > 0 ? (
        <span
          className="absolute bottom-0 top-0 w-3 border-l-2 border-line"
          style={{ left: depth * 16 - 8 }}
        />
      ) : null}
      {hasChildren ? (
        <button
          className="mt-1 h-5 w-4 shrink-0 rounded border-0 bg-transparent p-0 text-[10px] text-dim hover:text-ink"
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
          title={expanded ? "Згорнути" : "Розгорнути"}
        >
          {expanded ? "▼" : "▶"}
        </button>
      ) : (
        <span className="h-5 w-4 shrink-0" />
      )}
      <span
        className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${ico.cls}`}
        title={ico.tip}
      >
        {ico.glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={[
            "block overflow-hidden text-ellipsis text-[13px]",
            ico.aux ? "line-clamp-1 font-mono text-[11.5px] font-medium text-[#666]" : "line-clamp-2 font-semibold",
            depth ? "font-medium" : "",
          ].join(" ")}
        >
          {file.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-dim">
          {file.model ? <span className="rounded-full bg-chip px-2 py-0.5 font-mono text-[10px] font-semibold text-[#555]">{file.model}</span> : null}
          <span>{file.kind}</span>
          {flat ? <span className="max-w-[120px] truncate rounded-full bg-[#efeefb] px-2 py-0.5 text-[10.5px] font-semibold text-accent">{file.project}</span> : null}
          {activity}
          {hiddenCount ? (
            <span className="rounded-full bg-chip px-2 py-0.5 text-[10.5px] font-semibold text-dim">
              {hiddenLive ? "● " : ""}+{hiddenCount}
            </span>
          ) : null}
          <span>
            {fmtAge(file.mtime)} · {(file.size / 1024).toFixed(0)} kB
          </span>
        </span>
      </span>
    </div>
  );
}
