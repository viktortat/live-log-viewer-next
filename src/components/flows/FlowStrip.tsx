"use client";

import { useState } from "react";

import { Pause, Play, RefreshCw, X } from "lucide-react";

import type { Flow, FlowAction } from "@/lib/flows/types";

import { ATTENTION_STATES, patchFlow, STATE_LABELS, VERDICT_GLYPHS, verdictTone } from "./flowModel";

/* The one button the current state is waiting on, rendered prominent. */
const PENDING_ACTIONS: Partial<Record<Flow["state"], { label: string; action: FlowAction }>> = {
  waiting_ready: { label: "Почати ревью", action: "advance" },
  spawn_pending: { label: "Заспавнити ревʼюера", action: "advance" },
  relay_pending: { label: "Передати зауваження", action: "advance" },
  needs_decision: { label: "Повторити раунд", action: "retry-round" },
  done_comment: { label: "Ще коло", action: "another-round" },
};

const BUSY_STATES: ReadonlySet<Flow["state"]> = new Set(["spawning", "reviewing", "relaying", "fixing"]);

function stateDot(flow: Flow): string {
  if (flow.state === "approved") return "bg-ok";
  if (flow.state === "needs_decision") return "bg-err";
  if (flow.state === "paused") return "bg-[#e0ae45]";
  if (BUSY_STATES.has(flow.state)) return "bg-ok animate-pulse";
  return "bg-[#9a9aa4]";
}

/**
 * The loop at a glance, floating above the implementer's pane: state badge,
 * round chips colored by verdict, and the controls of the current state.
 * All mutations go through PATCH /api/flows/:id; the poll refresh carries
 * the resulting state back.
 */
export function FlowStrip({ flow, onFocusRound }: { flow: Flow; onFocusRound?: (n: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: FlowAction, extra?: { mode?: "auto" | "manual"; rounds?: number }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const fail = await patchFlow(flow.id, { action, ...extra });
    if (fail) setError(fail);
    setBusy(false);
  };

  const pending = PENDING_ACTIONS[flow.state];
  const attention = ATTENTION_STATES.has(flow.state);
  const closed = flow.state === "closed" || flow.state === "approved";

  return (
    <div
      data-scheme-ui
      className={`pointer-events-auto flex h-8 max-w-full items-center gap-1.5 overflow-x-auto rounded-full border bg-panel px-2 shadow-card ${
        attention ? "border-[#e0ae45]/70" : "border-line"
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${stateDot(flow)}`} aria-hidden />
      <span className="shrink-0 text-[10.5px] font-bold tracking-wide text-dim">ФЛОУ</span>
      <span className="shrink-0 text-[11px] font-semibold" title={flow.stateDetail ?? undefined}>
        {STATE_LABELS[flow.state]}
        {flow.stateDetail ? <span className="text-dim"> · {flow.stateDetail}</span> : null}
      </span>

      {flow.rounds.length ? (
        <span className="flex shrink-0 items-center gap-1" aria-label="Раунди ревью">
          {flow.rounds.map((round) => {
            const tone = verdictTone(round.verdict);
            const live = round.verdict === null && !round.error;
            return (
              <button
                key={round.n}
                className={`inline-flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  live ? "animate-pulse" : ""
                }`}
                style={{ backgroundColor: tone.soft, color: tone.color }}
                title={
                  round.error
                    ? `Раунд ${round.n}: ${round.error}`
                    : round.verdict
                      ? `Раунд ${round.n}: ${round.verdict}${round.findingsCount != null ? ` · ${round.findingsCount} знахідок` : ""}`
                      : `Раунд ${round.n}: триває`
                }
                onClick={() => onFocusRound?.(round.n)}
              >
                R{round.n}
                {round.verdict ? <span>{VERDICT_GLYPHS[round.verdict]}</span> : live ? <span>⏳</span> : <span>!</span>}
                {round.findingsCount != null && round.findingsCount > 0 ? <span>{round.findingsCount}</span> : null}
              </button>
            );
          })}
        </span>
      ) : null}

      {pending ? (
        <button
          className="shrink-0 rounded-full border border-accent bg-accent px-2.5 py-0.5 text-[11px] font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40"
          disabled={busy}
          onClick={() => void run(pending.action)}
        >
          {pending.label}
        </button>
      ) : null}
      {flow.state === "needs_decision" ? (
        <button
          className="shrink-0 rounded-full border border-line bg-bg px-2 py-0.5 text-[10.5px] font-semibold text-ink hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40"
          disabled={busy}
          title="Додати ще раунди до ліміту"
          onClick={() => void run("extend", { rounds: 2 })}
        >
          +2 раунди
        </button>
      ) : null}

      {closed ? null : (
        <>
          <button
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 ${
              flow.mode === "auto" ? "border-ok/40 bg-[#eef8f0] text-ok" : "border-line bg-bg text-dim hover:text-ink"
            }`}
            disabled={busy}
            title={flow.mode === "auto" ? "Авто: переходи самі. Клік — вручну." : "Вручну: кожен перехід чекає кліку. Клік — авто."}
            onClick={() => void run("set-mode", { mode: flow.mode === "auto" ? "manual" : "auto" })}
          >
            {flow.mode === "auto" ? "авто" : "вручну"}
          </button>
          {flow.state === "paused" ? (
            <button
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ok hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40"
              disabled={busy}
              title="Продовжити флоу"
              aria-label="Продовжити флоу"
              onClick={() => void run("resume")}
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <button
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-dim hover:bg-bg hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40"
              disabled={busy}
              title="Пауза"
              aria-label="Пауза"
              onClick={() => void run("pause")}
            >
              <Pause className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </>
      )}
      {busy ? <RefreshCw className="h-3 w-3 shrink-0 animate-spin text-dim" aria-hidden /> : null}
      {error ? <span className="shrink-0 text-[10.5px] font-semibold text-err">{error}</span> : null}
      <button
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-dim hover:bg-bg hover:text-err focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40"
        disabled={busy}
        title="Закрити флоу"
        aria-label="Закрити флоу"
        onClick={() => void run("close")}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}
