"use client";

import { ENGINE_EFFORTS } from "@/lib/agent/efforts";
import { useLocale } from "@/lib/i18n";

/** Codex speed choice: empty string keeps the user's config.toml default. */
export type SpeedChoice = "" | "fast" | "standard";

/**
 * Reasoning-effort select plus the codex-only speed (fast/standard) select —
 * the shared control strip for every "start a new agent" surface. The tier
 * list follows the engine; an empty value leaves the CLI on its own default.
 */
export function ReasoningControls({
  engine,
  effort,
  speed,
  disabled,
  onEffort,
  onSpeed,
}: {
  engine: "claude" | "codex";
  effort: string;
  speed: SpeedChoice;
  disabled?: boolean;
  onEffort: (value: string) => void;
  onSpeed: (value: SpeedChoice) => void;
}) {
  const { t } = useLocale();
  const selectClass =
    "h-7 min-w-0 rounded-[8px] border border-line bg-panel px-1.5 text-[11px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60";
  return (
    <>
      <select
        value={effort}
        disabled={disabled}
        aria-label={t("draft.reasoningAria")}
        title={t("draft.reasoningAria")}
        className={selectClass}
        onChange={(event) => onEffort(event.target.value)}
      >
        <option value="">{t("draft.effortDefault")}</option>
        {ENGINE_EFFORTS[engine].map((tier) => (
          <option key={tier} value={tier}>
            {tier}
          </option>
        ))}
      </select>
      {engine === "codex" ? (
        <select
          value={speed}
          disabled={disabled}
          aria-label={t("draft.speedAria")}
          title={t("draft.speedTitle")}
          className={selectClass}
          onChange={(event) => onSpeed(event.target.value as SpeedChoice)}
        >
          <option value="">{t("draft.speedDefault")}</option>
          <option value="fast">fast</option>
          <option value="standard">standard</option>
        </select>
      ) : null}
    </>
  );
}
