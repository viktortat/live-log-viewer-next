import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { RoleConfig } from "./types";
import { atomicWriteText, outputPathFor, stderrPathFor } from "./store";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export interface HeadlessRunResult {
  status: "running" | "done" | "failed" | "timeout";
  stdout: string;
  stderr: string;
  finalOutput: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface HeadlessReviewLaunch {
  sessionId: string | null;
  reviewerPath: string | null;
}

interface RunningReview {
  child: ChildProcess;
  startedAt: number;
  stdout: string;
  stderr: string;
  outputPath: string | null;
  result: HeadlessRunResult | null;
  timer: NodeJS.Timeout;
}

const runs = new Map<string, RunningReview>();

function runKey(flowId: string, round: number): string {
  return `${flowId}:${round}`;
}

function resolveBinary(name: string): string {
  const home = os.homedir();
  for (const candidate of [
    path.join(home, ".bun", "bin", name),
    path.join(home, ".npm-global", "bin", name),
    path.join(home, ".local", "bin", name),
    path.join(home, "go", "bin", name),
    "/usr/local/bin/" + name,
    "/usr/bin/" + name,
  ]) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return name;
}

function claudeTranscriptPath(cwd: string, sessionId: string): string {
  return path.join(os.homedir(), ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), sessionId + ".jsonl");
}

export function reviewerCommand(
  role: RoleConfig,
  prompt: string,
  outputPath: string,
  cwd: string,
): { command: string; args: string[]; outputPath: string | null; sessionId: string | null; reviewerPath: string | null } {
  if (role.engine === "claude") {
    const sessionId = crypto.randomUUID();
    const args = [
      "-p",
      prompt,
      "--dangerously-skip-permissions",
      "--session-id",
      sessionId,
      "--disallowedTools",
      "Edit,Write,NotebookEdit",
    ];
    if (role.model) args.push("--model", role.model);
    return { command: resolveBinary("claude"), args, outputPath: null, sessionId, reviewerPath: claudeTranscriptPath(cwd, sessionId) };
  }
  const args = ["exec", prompt, "--output-last-message", outputPath, "--sandbox", "read-only"];
  if (role.model) args.push("-m", role.model);
  if (role.effort) args.push("-c", `model_reasoning_effort=${role.effort}`);
  return { command: resolveBinary("codex"), args, outputPath, sessionId: null, reviewerPath: null };
}

export function startHeadlessReview(
  flowId: string,
  round: number,
  role: RoleConfig,
  cwd: string,
  prompt: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): HeadlessReviewLaunch {
  const key = runKey(flowId, round);
  if (runs.has(key)) return { sessionId: null, reviewerPath: null };
  const outputPath = outputPathFor(flowId, round);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const built = reviewerCommand(role, prompt, outputPath, cwd);
  const child = spawn(built.command, built.args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const run: RunningReview = {
    child,
    startedAt: Date.now(),
    stdout: "",
    stderr: "",
    outputPath: built.outputPath,
    result: null,
    timer: setTimeout(() => {
      if (!run.result) {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!run.result) child.kill("SIGKILL");
        }, 3_000).unref();
      }
    }, timeoutMs),
  };
  run.timer.unref();
  runs.set(key, run);

  child.stdout?.on("data", (chunk: Buffer) => {
    run.stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    run.stderr += chunk.toString("utf8");
  });
  child.on("error", (error) => {
    clearTimeout(run.timer);
    run.result = {
      status: "failed",
      stdout: run.stdout,
      stderr: `${run.stderr}\n${error instanceof Error ? error.message : String(error)}`.trim(),
      finalOutput: run.stdout,
      code: null,
      signal: null,
    };
  });
  child.on("close", (code, signal) => {
    if (run.result) return;
    clearTimeout(run.timer);
    const timedOut = Date.now() - run.startedAt >= timeoutMs && code === null;
    const captured = readOptional(run.outputPath) || run.stdout;
    if (run.stderr.trim()) atomicWriteText(stderrPathFor(flowId, round), run.stderr);
    run.result = {
      status: timedOut ? "timeout" : code === 0 ? "done" : "failed",
      stdout: run.stdout,
      stderr: run.stderr,
      finalOutput: captured,
      code,
      signal,
    };
  });
  return { sessionId: built.sessionId, reviewerPath: built.reviewerPath };
}

function readOptional(filePath: string | null): string {
  if (!filePath) return "";
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export function headlessReviewStatus(flowId: string, round: number): HeadlessRunResult | null {
  const run = runs.get(runKey(flowId, round));
  if (!run) return null;
  return run.result ?? {
    status: "running",
    stdout: run.stdout,
    stderr: run.stderr,
    finalOutput: "",
    code: null,
    signal: null,
  };
}

export function forgetHeadlessReview(flowId: string, round: number): void {
  runs.delete(runKey(flowId, round));
}
