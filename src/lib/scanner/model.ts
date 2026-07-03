import fs from "node:fs";
import path from "node:path";

import type { FileEntry } from "../types";
import { tailRecords } from "./activity";
import { globalCache } from "./caches";
import { readJson, recordValue, stringValue } from "./json";

const modelCache = globalCache<[number, string | null]>("model");

function shortModel(value: string | null): string | null {
  if (!value) return null;
  return value.trim().replace(/^claude-/, "").replace(/-20\d{6}$/, "");
}

function pickModel(entry: FileEntry, obj: Record<string, unknown>): string | null {
  if (entry.root === "codex-sessions") {
    if (obj.type === "turn_context" || obj.type === "session_meta") {
      return stringValue(recordValue(obj.payload)?.model);
    }
  } else if (obj.type === "assistant") {
    const model = stringValue(recordValue(obj.message)?.model);
    if (model && model !== "<synthetic>") return model;
  }
  return null;
}

export function entryModel(entry: FileEntry): string | null {
  if (entry.root === "claude-projects" && entry.path.includes(path.sep + "subagents" + path.sep)) {
    const meta = readJson(entry.path.slice(0, -".jsonl".length) + ".meta.json") ?? {};
    const model = stringValue(meta.model);
    if (model) return shortModel(model);
  }
  if ((entry.root !== "claude-projects" && entry.root !== "codex-sessions") || !entry.path.endsWith(".jsonl")) {
    return null;
  }
  const cached = modelCache.get(entry.path);
  if (cached?.[0] === entry.size) return cached[1];
  let model: string | null = null;
  for (const obj of tailRecords(entry.path, entry.size).reverse()) {
    model = pickModel(entry, obj);
    if (model) break;
  }
  if (!model) {
    try {
      const lines = fs.readFileSync(entry.path, "utf8").split("\n").slice(0, 41);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj && typeof obj === "object" && !Array.isArray(obj)) {
            model = pickModel(entry, obj);
            if (model) break;
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
  }
  const value = shortModel(model);
  modelCache.set(entry.path, [entry.size, value]);
  return value;
}
