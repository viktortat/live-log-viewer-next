import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveSpawnedTranscriptPath } from "./spawnedTranscript";

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "llv-spawned-transcript-test-"));

afterAll(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

interface RolloutPayload {
  cwd: string;
  id?: string;
  parent_thread_id?: string;
  source?: { subagent?: { thread_spawn?: { parent_thread_id?: string } } };
}

function writeCodexRollout(name: string, payload: RolloutPayload, mtimeMs: number): string {
  const pathname = path.join(SANDBOX, name);
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  fs.writeFileSync(pathname, JSON.stringify({ type: "session_meta", payload }) + "\n");
  const at = new Date(mtimeMs);
  fs.utimesSync(pathname, at, at);
  return pathname;
}

describe("resolveSpawnedTranscriptPath", () => {
  test("returns a known transcript path without polling", async () => {
    const result = await resolveSpawnedTranscriptPath({
      engine: "claude",
      knownTranscript: "/claude/new.jsonl",
      panePid: null,
      cwd: "/repo",
      startedAtMs: 1,
      env: {
        candidatePaths: () => {
          throw new Error("candidate scan should not run");
        },
      },
    });

    expect(result).toBe("/claude/new.jsonl");
  });

  test("resolves a fresh Codex rollout through holder ancestry to the pane pid", async () => {
    const fresh = writeCodexRollout("2026/07/08/rollout-fresh.jsonl", { cwd: "/repo" }, 10_000);
    const stale = writeCodexRollout("2026/07/08/rollout-stale.jsonl", { cwd: "/repo" }, 9_000);
    const holderByPath = new Map([
      [fresh, 301],
      [stale, 401],
    ]);
    const parentByPid = new Map<number, number | null>([
      [301, 200],
      [200, 100],
      [401, 400],
      [400, null],
    ]);

    const result = await resolveSpawnedTranscriptPath({
      engine: "codex",
      panePid: 100,
      cwd: "/repo",
      startedAtMs: 8_000,
      env: {
        candidatePaths: () => [fresh, stale],
        holderPidByPath: (paths) => new Map([...paths].flatMap((pathname) => {
          const holder = holderByPath.get(pathname);
          return holder === undefined ? [] : [[pathname, holder] as const];
        })),
        parentPidOf: (pid) => parentByPid.get(pid) ?? null,
        now: () => 12_000,
      },
    });

    expect(result).toBe(fresh);
  });

  test("resolves the root Codex rollout when a newer native subagent is writing under the same pane", async () => {
    const rootId = "019f421e-02e1-73e0-9b77-bebde063f10a";
    const childId = "019f423a-d6e9-7903-b597-3e676b6ff3d4";
    const root = writeCodexRollout(`2026/07/08/rollout-root-${rootId}.jsonl`, { id: rootId, cwd: "/repo" }, 10_000);
    const nativeChild = writeCodexRollout(
      `2026/07/08/rollout-child-${childId}.jsonl`,
      {
        id: childId,
        parent_thread_id: rootId,
        cwd: "/repo",
        source: { subagent: { thread_spawn: { parent_thread_id: rootId } } },
      },
      11_000,
    );
    const holderByPath = new Map([
      [nativeChild, 302],
      [root, 301],
    ]);
    const parentByPid = new Map<number, number | null>([
      [302, 200],
      [301, 200],
      [200, 100],
      [100, null],
    ]);

    const result = await resolveSpawnedTranscriptPath({
      engine: "codex",
      panePid: 100,
      cwd: "/repo",
      startedAtMs: 8_000,
      env: {
        candidatePaths: () => [nativeChild, root],
        holderPidByPath: (paths) => new Map([...paths].flatMap((pathname) => {
          const holder = holderByPath.get(pathname);
          return holder === undefined ? [] : [[pathname, holder] as const];
        })),
        parentPidOf: (pid) => parentByPid.get(pid) ?? null,
        now: () => 12_000,
      },
    });

    expect(result).toBe(root);
  });

  test("returns null when holder attribution is unavailable even with a unique cwd match", async () => {
    const match = writeCodexRollout("2026/07/08/rollout-match.jsonl", { cwd: "/repo" }, 10_000);
    const other = writeCodexRollout("2026/07/08/rollout-other.jsonl", { cwd: "/other" }, 10_000);

    const result = await resolveSpawnedTranscriptPath({
      engine: "codex",
      panePid: 100,
      cwd: "/repo",
      startedAtMs: 8_000,
      env: {
        candidatePaths: () => [match, other],
        holderPidByPath: () => new Map(),
        parentPidOf: () => null,
        now: () => 12_000,
        timeoutMs: 0,
      },
    });

    expect(result).toBeNull();
  });
});
