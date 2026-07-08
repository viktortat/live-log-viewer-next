import { describe, expect, test } from "bun:test";

import type { FileEntry } from "@/lib/types";

import { EFFORT_LEVEL_MAX, effortLevel } from "./utils";

function entry(effort: string | null | undefined): FileEntry {
  return {
    path: "/x.jsonl",
    root: "codex-sessions",
    name: "x.jsonl",
    project: "demo",
    title: "x",
    engine: "codex",
    kind: "session",
    fmt: "codex",
    parent: null,
    mtime: 1_000,
    size: 10,
    activity: "idle",
    proc: null,
    pid: null,
    model: "gpt-5.6",
    effort,
    pendingQuestion: null,
    waitingInput: null,
  };
}

describe("effortLevel", () => {
  test("maps the full minimal through max scale onto 1 through 6", () => {
    expect(effortLevel(entry("minimal"))).toBe(1);
    expect(effortLevel(entry("low"))).toBe(2);
    expect(effortLevel(entry("medium"))).toBe(3);
    expect(effortLevel(entry("high"))).toBe(4);
    expect(effortLevel(entry("xhigh"))).toBe(5);
    expect(effortLevel(entry("max"))).toBe(6);
    expect(EFFORT_LEVEL_MAX).toBe(6);
  });

  test("returns 0 for unknown, empty, or absent effort so the indicator hides", () => {
    expect(effortLevel(entry(null))).toBe(0);
    expect(effortLevel(entry(undefined))).toBe(0);
    expect(effortLevel(entry(""))).toBe(0);
    expect(effortLevel(entry("bogus"))).toBe(0);
  });
});
