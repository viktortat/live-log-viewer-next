"use client";

import { getLocale, translate } from "@/lib/i18n";
import type { BoardTask, TaskStatus } from "@/lib/tasks/types";

/** Fired after any successful task mutation so pollers refresh immediately. */
export const TASKS_CHANGED_EVENT = "llv:tasks-changed";

export function fireTasksChanged(): void {
  window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
}

/** Per-target delivery outcome of POST /api/tasks/:id/send. */
export interface TaskSendTargetOutcome {
  path: string;
  ok: boolean;
  target: string | null;
  error: string | null;
}

export interface TaskSendResult {
  task: BoardTask;
  results: TaskSendTargetOutcome[];
  delivered: number;
  failed: number;
}

export interface TaskSpawnResult {
  task: BoardTask;
  target: string;
  path: string | null;
  panePid: number | null;
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

async function request<T>(url: string, method: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || !json) {
      return {
        ok: false,
        status: res.status,
        error: json?.error ?? translate(getLocale(), "tasks.failed", { status: res.status }),
      };
    }
    fireTasksChanged();
    return { ok: true, data: json };
  } catch {
    return { ok: false, status: 0, error: translate(getLocale(), "common.serverUnavailable") };
  }
}

export async function createTask(input: {
  project: string;
  text: string;
  pos: { x: number; y: number };
}): Promise<{ task: BoardTask } | { error: string }> {
  const res = await request<{ task: BoardTask }>("/api/tasks", "POST", input);
  return res.ok ? { task: res.data.task } : { error: res.error };
}

/**
 * Partial update, last-write-wins. A 404 means DELETE won over this PATCH:
 * treated as success — the refetch fired here drops the card silently.
 */
export async function updateTask(
  id: string,
  patch: { text?: string; status?: TaskStatus; pos?: { x: number; y: number } },
): Promise<string | null> {
  const res = await request<{ task: BoardTask }>(`/api/tasks/${encodeURIComponent(id)}`, "PATCH", patch);
  if (!res.ok && res.status === 404) {
    fireTasksChanged();
    return null;
  }
  return res.ok ? null : res.error;
}

export async function deleteTask(id: string): Promise<string | null> {
  const res = await request<{ ok: true }>(`/api/tasks/${encodeURIComponent(id)}`, "DELETE");
  if (!res.ok && res.status === 404) {
    fireTasksChanged();
    return null;
  }
  return res.ok ? null : res.error;
}

/** Delivers the task to each target; returns the per-target breakdown. */
export async function sendTask(id: string, paths: string[]): Promise<TaskSendResult | { error: string }> {
  const res = await request<TaskSendResult>(`/api/tasks/${encodeURIComponent(id)}/send`, "POST", { paths });
  return res.ok ? res.data : { error: res.error };
}

export async function spawnTaskAgent(
  id: string,
  input: { engine: "claude" | "codex"; cwd: string },
): Promise<TaskSpawnResult | { error: string }> {
  const res = await request<TaskSpawnResult>(`/api/tasks/${encodeURIComponent(id)}/spawn`, "POST", input);
  return res.ok ? res.data : { error: res.error };
}
