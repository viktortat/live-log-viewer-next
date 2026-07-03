import fs from "node:fs";
import path from "node:path";

import type { FileEntry } from "../types";
import { globalCache } from "./caches";
import { taskParts } from "./discover";
import { readJson, recordValue, recordsValue, stringValue } from "./json";
import { findNeedle } from "./needle";
import { ROOTS } from "./roots";

const sidSlugCache = globalCache<string>("sid-slug");
const bgcmdCache = globalCache<{ command: string; description: string; source: string } | null>("bgcmd");

function globWalk(dir: string, pred: (pathname: string) => boolean, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const pathname = path.join(dir, entry.name);
    if (entry.isDirectory()) globWalk(pathname, pred, out);
    else if (entry.isFile() && pred(pathname)) out.push(pathname);
  }
  return out;
}

function sessionTranscripts(sid: string, slug?: string | null): [string | null, string[]] {
  const base = ROOTS["claude-projects"];
  let realSlug = slug ?? sidSlugCache.get(sid) ?? null;
  if (!realSlug) {
    const hit = globWalk(base, (p) => path.basename(p) === sid + ".jsonl")[0];
    if (!hit) return [null, []];
    realSlug = path.basename(path.dirname(hit));
    sidSlugCache.set(sid, realSlug);
  }
  const main = path.join(base, realSlug, sid + ".jsonl");
  const subDir = path.join(base, realSlug, sid, "subagents");
  const subs = globWalk(subDir, (p) => path.basename(p).startsWith("agent-") && p.endsWith(".jsonl")).sort();
  return [fs.existsSync(main) ? main : null, subs];
}

function jobMeta(logPath: string) {
  return readJson(logPath.replace(/\.log$/, ".json"));
}

function bgCommand(tid: string, transcripts: (string | null)[]) {
  if (bgcmdCache.has(tid)) return bgcmdCache.get(tid) ?? null;
  const needle = "background with ID: " + tid;
  const src = findNeedle(needle, transcripts);
  if (!src) return null;
  let toolId: string | null = null;
  let info: { command: string; description: string; source: string } | null = null;
  try {
    for (const line of fs.readFileSync(src, "utf8").split("\n")) {
      if (!line.includes(needle)) continue;
      toolId = line.match(/"tool_use_id"\s*:\s*"([^"]+)"/)?.[1] ?? null;
      break;
    }
    if (toolId) {
      for (const line of fs.readFileSync(src, "utf8").split("\n")) {
        if (!line.includes(toolId) || !line.includes('"tool_use"')) continue;
        try {
          const obj = JSON.parse(line);
          const content = recordsValue(recordValue(obj.message)?.content);
          for (const part of content) {
            if (part.type === "tool_use" && part.id === toolId) {
              const input = recordValue(part.input) ?? {};
              info = {
                command: String(input.command ?? ""),
                description: String(input.description ?? ""),
                source: src,
              };
              break;
            }
          }
        } catch {
          /* skip */
        }
        if (info) break;
      }
    }
  } catch {
    /* skip */
  }
  info ??= { command: "", description: "", source: src };
  bgcmdCache.set(tid, info);
  return info;
}

export function linkEntries(entries: FileEntry[]): void {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const threadMap = new Map<string, string>();
  if (fs.existsSync(ROOTS["codex-jobs"])) {
    for (const jsonPath of globWalk(
      ROOTS["codex-jobs"],
      (p) => path.basename(p).startsWith("task-") && p.endsWith(".json"),
    )) {
      const job = readJson(jsonPath);
      const threadId = stringValue(job?.threadId);
      if (threadId) threadMap.set(threadId, jsonPath.slice(0, -".json".length) + ".log");
    }
  }
  for (const entry of entries) {
    if (entry.root === "claude-projects") {
      const parts = entry.name.split(path.sep);
      if (parts.length >= 3 && parts.at(-2) === "subagents") {
        const slug = parts[0] ?? "";
        const sid = parts.at(-3) ?? "";
        const [main, subs] = sessionTranscripts(sid, slug);
        entry.parent = main;
        const meta = readJson(entry.path.slice(0, -".jsonl".length) + ".meta.json") ?? {};
        const toolUse = stringValue(meta.toolUseId);
        const spawnDepth = Number(meta.spawnDepth ?? 0);
        if (toolUse && spawnDepth >= 1) {
          const found = findNeedle(
            toolUse,
            subs.filter((item) => item !== entry.path).concat(main ? [main] : []),
          );
          if (found) entry.parent = found;
        }
      }
    } else if (entry.root === "codex-jobs") {
      const job = jobMeta(entry.path) ?? {};
      const sid = stringValue(job.sessionId);
      if (sid) {
        const ws = stringValue(job.workspaceRoot) ?? "";
        const slug = ws ? ws.replace(/[^A-Za-z0-9-]/g, "-") : null;
        let [main, subs] = sessionTranscripts(sid, slug);
        if (!main && slug) [main, subs] = sessionTranscripts(sid, null);
        const jobId = path.basename(entry.path).slice(0, -".log".length);
        const found = findNeedle(jobId, subs);
        entry.parent = found ?? main;
      }
    } else if (entry.root === "codex-sessions") {
      const threadId = entry.path.match(/([0-9a-f-]{36})\.jsonl$/)?.[1];
      if (threadId && threadMap.has(threadId)) entry.parent = threadMap.get(threadId) ?? null;
    } else if (entry.root === "claude-tasks") {
      const parts = taskParts(ROOTS["claude-tasks"], entry.path);
      if (!parts) continue;
      const [slug, sid, tid] = parts;
      const [main, subs] = sessionTranscripts(sid, slug);
      const info = bgCommand(tid, (main ? [main] : []).concat(subs));
      if (info) {
        entry.parent = info.source;
        entry.cmd = info.command;
        entry.cmdDesc = info.description;
        const base = info.description || info.command;
        if (base) entry.title = base.split(/\s+/).join(" ").slice(0, 120);
      } else {
        entry.title = "Фонова задача " + tid;
        entry.cmd = "";
        entry.cmdDesc = "";
      }
    }
  }
  const rootProject = (entry: FileEntry): string => {
    const seen = new Set<string>();
    let cur: FileEntry = entry;
    while (!seen.has(cur.path)) {
      seen.add(cur.path);
      const parent = byPath.get(cur.parent ?? "");
      if (!parent) return cur.project;
      cur = parent;
    }
    return entry.project;
  };
  for (const entry of entries) {
    if (!entry.parent || !byPath.has(entry.parent)) entry.parent = null;
    else entry.project = rootProject(entry);
  }
}
