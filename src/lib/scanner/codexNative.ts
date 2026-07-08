import fs from "node:fs";
import path from "node:path";

import { globalCache } from "./caches";
import { recordValue, stringValue } from "./json";

const codexNativeParentCache = globalCache<[number, string | null]>("codex-native-parent-thread");

export const CODEX_NATIVE_HEAD_BYTES = 64 * 1024;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function codexThreadIdFromPath(pathname: string): string | null {
  return path.basename(pathname).match(UUID_RE)?.[0] ?? null;
}

export function nativeCodexParentThreadId(pathname: string, size: number): string | null {
  const cached = codexNativeParentCache.get(pathname);
  if (cached && (cached[1] !== null || cached[0] >= CODEX_NATIVE_HEAD_BYTES || cached[0] >= size)) return cached[1];

  let read = 0;
  let parent: string | null = null;
  try {
    const fd = fs.openSync(pathname, "r");
    try {
      const buf = Buffer.alloc(Math.min(size, CODEX_NATIVE_HEAD_BYTES));
      read = fs.readSync(fd, buf, 0, buf.length, 0);
      for (const line of buf.toString("utf8", 0, read).split("\n")) {
        if (!line.includes('"session_meta"')) continue;
        const obj = JSON.parse(line) as {
          payload?: {
            parent_thread_id?: unknown;
            source?: { subagent?: { thread_spawn?: { parent_thread_id?: unknown } } };
          };
        };
        const payload = recordValue(obj.payload);
        if (!payload) continue;
        const source = recordValue(payload.source);
        const subagent = recordValue(source?.subagent);
        const threadSpawn = recordValue(subagent?.thread_spawn);
        const direct = stringValue(payload.parent_thread_id);
        const nested = stringValue(threadSpawn?.parent_thread_id);
        parent = direct ?? nested;
        break;
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    parent = null;
  }
  codexNativeParentCache.set(pathname, [read, parent]);
  return parent;
}

export function isNativeCodexSubagentTranscript(pathname: string, size: number): boolean {
  return nativeCodexParentThreadId(pathname, size) !== null;
}
