"use client";

/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useRef, useState } from "react";

import type { FileEntry } from "@/lib/types";
import type { LogChunk } from "@/lib/types";

const POLL_MS = 1200;

export interface LogTailState {
  lines: string[];
  size: number;
  loading: boolean;
  error: string | null;
  tickTime: Date | null;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  clear: () => void;
}

export function useLogTail(file: FileEntry | null, pausedInput = false): LogTailState {
  const [lines, setLines] = useState<string[]>([]);
  const [size, setSize] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickTime, setTickTime] = useState<Date | null>(null);
  const [paused, setPaused] = useState(false);
  const offsetRef = useRef(0);
  const tailRef = useRef("");
  const firstRef = useRef(true);
  const genRef = useRef(0);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused || pausedInput;
  }, [paused, pausedInput]);

  const clear = useCallback(() => {
    setLines([]);
    offsetRef.current = 0;
    tailRef.current = "";
    firstRef.current = true;
  }, []);

  useEffect(() => {
    genRef.current += 1;
    offsetRef.current = 0;
    tailRef.current = "";
    firstRef.current = true;
    setLines([]);
    setSize(file?.size ?? 0);
    setError(null);
    setLoading(Boolean(file));
  }, [file?.path, file?.size]);

  useEffect(() => {
    if (!file) return;
    let alive = true;
    const gen = genRef.current;
    const poll = async () => {
      if (!alive || pausedRef.current) return;
      try {
        const res = await fetch(`/api/log?path=${encodeURIComponent(file.path)}&offset=${offsetRef.current}`);
        const json = (await res.json()) as LogChunk | { error?: string };
        if (!alive || gen !== genRef.current) return;
        if ("error" in json && json.error) {
          setError(json.error);
          setLoading(false);
          return;
        }
        const chunk = json as LogChunk;
        if (offsetRef.current > chunk.size) {
          offsetRef.current = 0;
          tailRef.current = "";
          firstRef.current = true;
          setLines([]);
        }
        if (chunk.data) {
          let data = tailRef.current + chunk.data;
          tailRef.current = "";
          if (firstRef.current && chunk.size > chunk.data.length) {
            const nl = data.indexOf("\n");
            data = nl >= 0 ? data.slice(nl + 1) : "";
          }
          const parts = data.split("\n");
          tailRef.current = parts.pop() ?? "";
          const complete = parts.map((line) => line.trim()).filter(Boolean);
          if (offsetRef.current === 0) setLines(complete);
          else if (complete.length) setLines((prev) => prev.concat(complete).slice(-2500));
          firstRef.current = false;
        }
        offsetRef.current = chunk.offset;
        setSize(chunk.size);
        setError(null);
        setTickTime(new Date());
        setLoading(false);
      } catch {
        if (alive && gen === genRef.current) {
          setError("сервер недоступний");
          setLoading(false);
        }
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [file, file?.path]);

  return { lines, size, loading, error, tickTime, paused, setPaused, clear };
}
