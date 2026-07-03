import fs from "node:fs";

import { globalCache } from "./caches";

interface NeedleEntry {
  found: string | null;
  scanned: Record<string, number>;
}

const needleCache = globalCache<NeedleEntry>("needle");

export function findNeedle(needle: string, paths: (string | null | undefined)[]): string | null {
  const ent = needleCache.get(needle) ?? { found: null, scanned: {} };
  needleCache.set(needle, ent);
  if (ent.found) return ent.found;
  const nb = Buffer.from(needle);
  const pad = Math.max(0, nb.length - 1);
  for (const pathname of paths) {
    if (!pathname) continue;
    let size: number;
    try {
      size = fs.statSync(pathname).size;
    } catch {
      continue;
    }
    const done = ent.scanned[pathname] ?? 0;
    if (size <= done) continue;
    try {
      const fd = fs.openSync(pathname, "r");
      try {
        const start = Math.max(0, done - pad);
        let pos = start;
        let carry = Buffer.alloc(0);
        let hit = false;
        while (pos < size) {
          const len = Math.min(1 << 20, size - pos);
          const chunk = Buffer.alloc(len);
          const read = fs.readSync(fd, chunk, 0, len, pos);
          if (!read) break;
          const hay = Buffer.concat([carry, chunk.subarray(0, read)]);
          if (hay.includes(nb)) {
            hit = true;
            break;
          }
          carry = pad ? chunk.subarray(Math.max(0, read - pad), read) : Buffer.alloc(0);
          pos += read;
        }
        ent.scanned[pathname] = size;
        if (hit) {
          ent.found = pathname;
          return pathname;
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      continue;
    }
  }
  return null;
}
