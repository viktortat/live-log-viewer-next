"use client";

import { getLocale, translate, useLocale } from "@/lib/i18n";
import type { AgentGoal, AgentPlan, CtxUsage } from "@/lib/types";

const bcp47 = () => (getLocale() === "uk" ? "uk-UA" : "en-US");

const STEP_GLYPHS: Record<AgentPlan["steps"][number]["status"], string> = {
  completed: "✓",
  in_progress: "▸",
  pending: "○",
};

export function planTooltip(plan: AgentPlan): string {
  const lines = plan.steps.map((step) => `${STEP_GLYPHS[step.status]} ${step.text}`);
  return [translate(getLocale(), "plan.agentPlan"), ...lines].join("\n");
}

/**
 * Compact plan progress in a pane header: done/total plus a slim bar. The
 * full step list (with the current goal marked ▸) lives in the tooltip — the
 * header has no room for more, and the switchboard already spells the goal out.
 */
export function PlanChip({ plan }: { plan: AgentPlan }) {
  const { t } = useLocale();
  const percent = plan.total ? Math.round((plan.done / plan.total) * 100) : 0;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#f1f0fc] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-accent"
      title={planTooltip(plan)}
      aria-label={t("plan.stepsAria", { done: plan.done, total: plan.total }) + (plan.current ? t("plan.nowSuffix", { current: plan.current }) : "")}
    >
      {plan.done}/{plan.total}
      <span className="h-1 w-6 overflow-hidden rounded-full bg-accent/20" aria-hidden>
        <span className="block h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

const GOAL_TONES: Record<AgentGoal["status"], { labelKey: "plan.goal" | "plan.goalDone" | "plan.goalBlocked"; className: string }> = {
  active: { labelKey: "plan.goal", className: "bg-[#f1f0fc] text-accent" },
  complete: { labelKey: "plan.goalDone", className: "bg-[#e7f4ea] text-ok" },
  blocked: { labelKey: "plan.goalBlocked", className: "bg-[#fbeaea] text-err" },
};

function goalTooltip(goal: AgentGoal): string {
  const locale = getLocale();
  const lines = [goal.objective ?? translate(locale, "plan.noObjective")];
  if (goal.tokensUsed !== null) lines.push(translate(locale, "plan.tokens", { n: goal.tokensUsed.toLocaleString(bcp47()) }));
  if (goal.timeUsedSeconds !== null) lines.push(translate(locale, "plan.time", { n: Math.round(goal.timeUsedSeconds / 60) }));
  return lines.join("\n");
}

/* Same escalation points as the sidebar limit bars: calm, then amber, then red. */
function ctxTone(pct: number): string {
  if (pct >= 90) return "bg-[#fbeaea] text-err";
  if (pct >= 70) return "bg-[#fff7e6] text-[#b07d18]";
  return "bg-chip text-dim";
}

/** Context-window fullness of an agent: «ctx N%», exact token counts in the
    tooltip. Rendered wherever the agent is shown (pane header, switch cards). */
export function CtxChip({ ctx }: { ctx: CtxUsage }) {
  const { t } = useLocale();
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-semibold ${ctxTone(ctx.pct)}`}
      title={t("plan.ctxTitle", { pct: ctx.pct, used: ctx.usedTokens.toLocaleString(bcp47()), window: ctx.windowTokens.toLocaleString(bcp47()) })}
      aria-label={t("plan.ctxAria", { pct: ctx.pct })}
    >
      ctx {ctx.pct}%
    </span>
  );
}

/** Codex thread-goal state in a pane header: status-colored chip, the
    objective and usage numbers in the tooltip. */
export function GoalChip({ goal }: { goal: AgentGoal }) {
  const { t } = useLocale();
  const tone = GOAL_TONES[goal.status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold ${tone.className}`}
      title={goalTooltip(goal)}
      aria-label={t("plan.goalAria", { status: t(tone.labelKey) }) + (goal.objective ? ` — ${goal.objective.slice(0, 120)}` : "")}
    >
      {t(tone.labelKey)}
    </span>
  );
}
