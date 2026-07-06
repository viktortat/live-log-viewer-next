import { describe, expect, test } from "bun:test";

import { allowedKillTargetPid, consumeKillTarget, noteSessionTargets } from "./resources";

describe("kill-target allowlist", () => {
  test("nothing is killable before a snapshot exists", () => {
    noteSessionTargets([]);
    expect(allowedKillTargetPid("agents:1.0")).toBeNull();
    expect(allowedKillTargetPid("")).toBeNull();
  });

  test("only targets from the last snapshot pass, each with its pane pid", () => {
    noteSessionTargets([
      { target: "agents:1.0", panePid: 111 },
      { target: "agents:2.0", panePid: 222 },
    ]);
    expect(allowedKillTargetPid("agents:1.0")).toBe(111);
    expect(allowedKillTargetPid("agents:2.0")).toBe(222);
    expect(allowedKillTargetPid("agents:3.0")).toBeNull();
    expect(allowedKillTargetPid("main:0.0")).toBeNull();
  });

  test("a new snapshot replaces the allowlist, never accumulates", () => {
    noteSessionTargets([{ target: "agents:1.0", panePid: 111 }]);
    noteSessionTargets([{ target: "agents:2.0", panePid: 222 }]);
    expect(allowedKillTargetPid("agents:1.0")).toBeNull();
    expect(allowedKillTargetPid("agents:2.0")).toBe(222);
  });

  test("a consumed target no longer passes — tmux may reuse its coordinates", () => {
    noteSessionTargets([
      { target: "agents:1.0", panePid: 111 },
      { target: "agents:2.0", panePid: 222 },
    ]);
    consumeKillTarget("agents:1.0");
    expect(allowedKillTargetPid("agents:1.0")).toBeNull();
    expect(allowedKillTargetPid("agents:2.0")).toBe(222);
  });
});
