import fs from "node:fs";
import path from "node:path";

import type { FileEntry, RootKey } from "../types";
import { describe } from "./describe";
import { EXTS, FILE_CAP, ROOTS } from "./roots";

export function taskParts(root: string, pathname: string): [string, string, string] | null {
  const parts = path.relative(root, pathname).split(path.sep);
  if (parts.length === 4 && parts[2] === "tasks" && parts[3]?.endsWith(".output")) {
    return [parts[0] ?? "", parts[1] ?? "", parts[3].slice(0, -".output".length)];
  }
  return null;
}

function walk(rootName: RootKey, root: string, dir: string, out: FileEntry[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".git")) continue;
      walk(rootName, root, path.join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile() || !EXTS.some((ext) => entry.name.endsWith(ext))) continue;
    const pathname = path.join(dir, entry.name);
    if (rootName === "claude-projects" && pathname.includes(path.sep + "tool-results" + path.sep)) continue;
    let st: fs.Stats;
    try {
      st = fs.statSync(pathname);
    } catch {
      continue;
    }
    const isTask = rootName === "claude-tasks" ? taskParts(ROOTS["claude-tasks"], pathname) : null;
    if (rootName === "claude-tasks" && !isTask) continue;
    if (st.size === 0 && !isTask) continue;
    if (isTask) {
      const [slug, sid, tid] = isTask;
      const twin = path.join(ROOTS["claude-projects"], slug, sid, "subagents", "agent-" + tid + ".jsonl");
      if (fs.existsSync(twin)) continue;
    }
    const meta = describe(rootName, root, pathname, st);
    out.push({
      path: pathname,
      root: rootName,
      name: path.relative(root, pathname),
      project: meta.project,
      title: meta.title,
      engine: meta.engine,
      kind: meta.kind,
      fmt: meta.fmt,
      parent: null,
      mtime: st.mtimeMs / 1000,
      size: st.size,
      activity: "idle",
      model: null,
    });
  }
}

export function discoverFiles(): FileEntry[] {
  const out: FileEntry[] = [];
  for (const [rootName, root] of Object.entries(ROOTS) as [RootKey, string][]) {
    if (fs.existsSync(root)) walk(rootName, root, root, out);
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, FILE_CAP);
}
