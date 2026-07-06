"use client";

import { useEffect, useRef } from "react";

import { paneState, type PaneState } from "@/components/paneState";
import { isAuxTask } from "@/components/projectModel";
import { chime, type ChimeKind, panForPane, primeAudio } from "@/lib/chime";
import type { FileEntry } from "@/lib/types";

const CHIME_OF: Partial<Record<PaneState, ChimeKind>> = {
  waiting: "waiting",
  returned: "returned",
  stalled: "stalled",
};

/** Several agents finishing in one poll ring as a cascade, not a cluster chord. */
const STAGGER_MS = 220;

interface Tracked {
  state: PaneState;
  parent: string | null;
}

/**
 * Watches the polled file list for lifecycle transitions and rings a chime
 * when an agent finishes its turn: left `live` into an attention state, or
 * appeared already finished (a branch that ran its whole life between polls).
 * A new node joining the agent tree — a fresh subagent, or an existing
 * conversation whose parent link got resolved — rings its own `spawned`
 * blip, unless a finish chime for the same path already carries the news.
 * The first poll after page load only seeds the baseline — reloading over
 * finished work stays silent.
 */
export function useAgentChimes(files: FileEntry[]) {
  const prevRef = useRef<Map<string, Tracked> | null>(null);
  /* Children that already rang their spawn blip; a parent link that flaps
     null → set → null in the scanner must not re-announce the same agent. */
  const linkedRef = useRef<Set<string>>(new Set());

  useEffect(() => primeAudio(), []);

  useEffect(() => {
    if (!files.length) return;
    const next = new Map<string, Tracked>();
    for (const file of files) {
      if (!isAuxTask(file)) next.set(file.path, { state: paneState(file), parent: file.parent });
    }
    const prev = prevRef.current;
    prevRef.current = next;
    const linked = linkedRef.current;
    if (!prev) {
      for (const [path, cur] of next) if (cur.parent) linked.add(path);
      return;
    }
    let voice = 0;
    for (const [path, cur] of next) {
      const file = files.find((item) => item.path === path);
      const kind = file?.pendingQuestion || file?.waitingInput ? "question" : CHIME_OF[cur.state];
      const was = prev.get(path);
      const finished = kind !== undefined && (was?.state === "live" || was === undefined);
      if (finished) chime(kind, panForPane(path), voice++ * STAGGER_MS);
      if (cur.parent && !linked.has(path)) {
        linked.add(path);
        /* Skip the blip when a finish chime just announced this same path —
           a subagent that lived its whole life between polls rings once. */
        if (!finished) chime("spawned", panForPane(path), voice++ * STAGGER_MS);
      }
    }
  }, [files]);
}
