import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "bun:test";

import type { RootKey } from "../types";
import { discoverFiles } from "./discover";
import { FILE_CAP } from "./roots";

async function writeFixture(pathname: string, content: string, mtimeSeconds: number): Promise<void> {
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(pathname, content);
  await utimes(pathname, mtimeSeconds, mtimeSeconds);
}

test("discoverFiles preserves scanner filters, mtime ordering, and the cap", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "llv-discover-"));
  try {
    const roots: Record<RootKey, string> = {
      "codex-sessions": path.join(base, "codex-sessions"),
      "claude-projects": path.join(base, "claude-projects"),
      "claude-tasks": path.join(base, "claude-tasks"),
    };
    await Promise.all(Object.values(roots).map((root) => mkdir(root, { recursive: true })));

    const startedAt = 1_700_000_000;
    for (let index = 0; index < FILE_CAP; index += 1) {
      const pathname = path.join(roots["codex-sessions"], `session-${String(index).padStart(3, "0")}.jsonl`);
      await writeFixture(
        pathname,
        JSON.stringify({ payload: { cwd: "/home/user/project" }, type: "session" }) + "\n",
        startedAt + index,
      );
    }

    const taskPath = path.join(roots["claude-tasks"], "project-a", "sid-a", "tasks", "keep.output");
    await writeFixture(taskPath, "", startedAt + FILE_CAP + 10);

    await writeFixture(path.join(roots["codex-sessions"], "too-new.bin"), "skip", startedAt + FILE_CAP + 20);
    await writeFixture(path.join(roots["codex-sessions"], "empty.jsonl"), "", startedAt + FILE_CAP + 30);
    await writeFixture(
      path.join(roots["claude-projects"], "project-a", "sid-a", "tool-results", "tool.jsonl"),
      "{}\n",
      startedAt + FILE_CAP + 40,
    );
    await writeFixture(
      path.join(roots["claude-tasks"], "project-a", "sid-a", "scratchpad.txt"),
      "skip\n",
      startedAt + FILE_CAP + 50,
    );
    await writeFixture(
      path.join(roots["claude-tasks"], "project-a", "sid-a", "tasks", "mirrored.output"),
      "skip\n",
      startedAt + FILE_CAP + 60,
    );
    await writeFixture(
      path.join(roots["claude-projects"], "project-a", "sid-a", "subagents", "agent-mirrored.jsonl"),
      "{}\n",
      startedAt - 1,
    );

    const entries = await discoverFiles(roots);

    expect(entries).toHaveLength(FILE_CAP);
    expect(entries[0]?.path).toBe(taskPath);
    expect(entries.slice(1).map((entry) => entry.name)).toEqual(
      Array.from({ length: FILE_CAP - 1 }, (_, offset) => {
        const index = FILE_CAP - 1 - offset;
        return `session-${String(index).padStart(3, "0")}.jsonl`;
      }),
    );
    expect(entries.some((entry) => entry.name === "session-000.jsonl")).toBe(false);
    expect(entries.map((entry) => entry.path)).toEqual([...entries].sort((a, b) => b.mtime - a.mtime).map((entry) => entry.path));
    expect(entries.every((entry) => entry.path !== path.join(roots["codex-sessions"], "too-new.bin"))).toBe(true);
    expect(entries.every((entry) => entry.path !== path.join(roots["codex-sessions"], "empty.jsonl"))).toBe(true);
    expect(entries.every((entry) => !entry.path.includes(path.sep + "tool-results" + path.sep))).toBe(true);
    expect(entries.every((entry) => !entry.path.endsWith("scratchpad.txt"))).toBe(true);
    expect(entries.every((entry) => !entry.path.endsWith("mirrored.output"))).toBe(true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("discoverFiles keeps native Codex spawn parents outside the recent cap", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "llv-discover-parent-"));
  try {
    const roots: Record<RootKey, string> = {
      "codex-sessions": path.join(base, "codex-sessions"),
      "claude-projects": path.join(base, "claude-projects"),
      "claude-tasks": path.join(base, "claude-tasks"),
    };
    await Promise.all(Object.values(roots).map((root) => mkdir(root, { recursive: true })));

    const parentId = "019f421e-02e1-73e0-9b77-bebde063f10a";
    const childId = "019f423a-d6e9-7903-b597-3e676b6ff3d4";
    const startedAt = 1_700_010_000;
    const parentPath = path.join(roots["codex-sessions"], "2026", "07", "08", `rollout-parent-${parentId}.jsonl`);
    const childPath = path.join(roots["codex-sessions"], "2026", "07", "08", `rollout-child-${childId}.jsonl`);
    await writeFixture(parentPath, JSON.stringify({ type: "session_meta", payload: { id: parentId, cwd: "/repo" } }) + "\n", startedAt - 10);
    await writeFixture(
      childPath,
      JSON.stringify({ type: "session_meta", payload: { id: childId, parent_thread_id: parentId, cwd: "/repo" } }) + "\n",
      startedAt + FILE_CAP + 10,
    );
    for (let index = 0; index < FILE_CAP - 1; index += 1) {
      const pathname = path.join(roots["codex-sessions"], `filler-${String(index).padStart(3, "0")}.jsonl`);
      await writeFixture(pathname, JSON.stringify({ type: "session_meta", payload: { cwd: "/repo" } }) + "\n", startedAt + index);
    }

    const entries = await discoverFiles(roots);

    expect(entries).toHaveLength(FILE_CAP + 1);
    expect(entries[0]?.path).toBe(childPath);
    expect(entries.some((entry) => entry.path === parentPath)).toBe(true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
