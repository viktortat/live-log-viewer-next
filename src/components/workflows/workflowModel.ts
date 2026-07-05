import { getLocale, type TFunction, translate } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";
import type { Workflow, WorkflowAction, WorkflowState } from "@/lib/workflows/types";

/** Fired after any successful workflow mutation so pollers refresh now. */
export const WORKFLOWS_CHANGED_EVENT = "llv:workflows-changed";

/** Workflow drafts share the dashboard's draft list with agent drafts; the
    id prefix picks which pane renders (agent ids are plain uuids, so the
    non-hex prefix never collides). */
export const WORKFLOW_DRAFT_PREFIX = "wf-";

export function isWorkflowDraftId(id: string): boolean {
  return id.startsWith(WORKFLOW_DRAFT_PREFIX);
}

/** Workflows a project's dashboard shows: those whose agents live in the
    project's files, plus fresh ones matched by repo/worktree directory name
    (project slugs end with the directory basename) so the strip appears
    while provisioning, before any transcript exists. */
export function workflowsForProject(workflows: Workflow[], project: string, files: FileEntry[]): Workflow[] {
  const projectPaths = new Set(files.filter((file) => file.project === project).map((file) => file.path));
  const basename = (dir: string) => dir.split("/").filter(Boolean).at(-1) ?? "";
  return workflows.filter((wf) => {
    if (wf.state === "closed") return false;
    if (wf.stageRuns.some((run) => run.agentPath && projectPaths.has(run.agentPath))) return true;
    if (wf.fixerPath && projectPaths.has(wf.fixerPath)) return true;
    return basename(wf.worktreeDir) === project || basename(wf.repoDir) === project;
  });
}

/** Localized lifecycle-state label; keys live under wfState.* in the dicts. */
export function workflowStateLabel(t: TFunction, state: WorkflowState): string {
  return t(`wfState.${state}`);
}

/** States that ask for the user's attention on the strip. */
export const WF_ATTENTION_STATES: ReadonlySet<WorkflowState> = new Set(["needs_decision", "paused", "approved"]);

export const WF_BUSY_STATES: ReadonlySet<WorkflowState> = new Set(["provisioning", "implementing", "reviewing", "finishing"]);

/** A manual-mode workflow whose current stage finished waits on advance. */
export function isGateOpen(wf: Workflow): boolean {
  if (wf.state !== "implementing" && wf.state !== "reviewing") return false;
  return Boolean(wf.stageRuns[wf.stageIndex]?.doneAt);
}

export async function patchWorkflow(id: string, body: { action: WorkflowAction; note?: string }): Promise<string | null> {
  try {
    const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      window.dispatchEvent(new Event(WORKFLOWS_CHANGED_EVENT));
      return null;
    }
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    return json?.error ?? translate(getLocale(), "wfModel.failed", { status: res.status });
  } catch {
    return translate(getLocale(), "common.serverUnavailable");
  }
}
