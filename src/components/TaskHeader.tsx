"use client";

import type { FileEntry } from "@/lib/types";

export function TaskHeader({ file }: { file: FileEntry }) {
  if (file.root !== "claude-tasks") return null;
  return (
    <div className="mb-4 mt-1 rounded-[14px] border border-line bg-panel px-4 py-3 shadow-card">
      {file.cmd ? (
        <>
          <div className="mb-1 text-[13.5px] font-semibold">{file.cmdDesc || "Фонова команда"}</div>
          <code className="block whitespace-pre-wrap break-words rounded-lg border border-line bg-[#fafafc] px-2.5 py-2 font-mono text-[12.5px]">
            $ {file.cmd}
          </code>
        </>
      ) : (
        <div className="text-[13.5px] text-dim">Команду, що запустила цю фонову задачу, не знайдено у транскриптах сесії</div>
      )}
    </div>
  );
}
