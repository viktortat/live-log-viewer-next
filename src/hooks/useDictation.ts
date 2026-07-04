"use client";

import { useEffect, useRef, useState } from "react";

export type DictationPhase = "idle" | "rec" | "busy";

const MAX_SECONDS = 120;
/* Sub-2KB blobs are a misclick, not speech — dropped without a server call. */
const MIN_BLOB_BYTES = 2_000;

export const METER_BARS = 13;
export const METER_WIDTH = 56;
export const METER_HEIGHT = 16;
/* Voice energy lives in the lower spectrum; the top bins of a 64-bin FFT stay
   near zero and would render as permanently dead bars. */
const METER_SPECTRUM_SHARE = 0.65;

export function fmtElapsed(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function drawMeter(canvas: HTMLCanvasElement, bins: Uint8Array): void {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== METER_WIDTH * dpr || canvas.height !== METER_HEIGHT * dpr) {
    canvas.width = METER_WIDTH * dpr;
    canvas.height = METER_HEIGHT * dpr;
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, METER_WIDTH, METER_HEIGHT);
  const usable = Math.max(METER_BARS, Math.floor(bins.length * METER_SPECTRUM_SHARE));
  const step = usable / METER_BARS;
  const barWidth = METER_WIDTH / METER_BARS;
  for (let i = 0; i < METER_BARS; i += 1) {
    const from = Math.floor(i * step);
    const to = Math.max(from + 1, Math.floor((i + 1) * step));
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += bins[j] ?? 0;
    const level = sum / (to - from) / 255;
    const barHeight = Math.max(1.5, level * METER_HEIGHT);
    g.fillStyle = `rgba(198, 40, 40, ${(0.35 + level * 0.65).toFixed(3)})`;
    g.fillRect(i * barWidth + 1, (METER_HEIGHT - barHeight) / 2, barWidth - 2, barHeight);
  }
}

export interface UseDictationOptions {
  onError: (message: string) => void;
  /** Receives a transcript no stop() call was waiting for. The 120s auto-stop
      fires rec.stop() with no pending resolver; without this handler that
      recording's text would be silently dropped. */
  onUnclaimedText: (text: string) => void;
}

export interface UseDictationResult {
  phase: DictationPhase;
  elapsed: number;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  start: () => Promise<void>;
  /**
   * Stops recording and transcribes it through /api/transcribe, resolving with
   * the recognised text. Resolves null when there is nothing usable — a
   * discard, a misclick-length blob, or a reported error (already surfaced via
   * onError) — so a caller only ever acts on a non-null result.
   */
  stop: () => Promise<string | null>;
  discard: () => void;
}

/**
 * Recording + transcription state machine shared by every dictation control:
 * getUserMedia + MediaRecorder (webm/opus), a live input-level meter, and a
 * stop that resolves once /api/transcribe answers. Lifted out of MicButton so
 * a composer can orchestrate its own send button around the same recording
 * (see TmuxComposer's stop-and-send).
 */
export function useDictation({ onError, onUnclaimedText }: UseDictationOptions): UseDictationResult {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meterRef = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const pendingRef = useRef<((text: string | null) => void) | null>(null);
  const startingRef = useRef(false);

  const stopTimer = () => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopMeter = () => {
    const meter = meterRef.current;
    meterRef.current = null;
    if (meter) {
      cancelAnimationFrame(meter.raf);
      void meter.ctx.close().catch(() => undefined);
    }
  };

  /* Live input-level bars during recording. Dictation works without them, so
     an AudioContext failure only costs the visual. */
  const startMeter = (stream: MediaStream) => {
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.7;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      if (!meterRef.current) return;
      meterRef.current.raf = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(bins);
      const canvas = canvasRef.current;
      if (canvas) drawMeter(canvas, bins);
    };
    meterRef.current = { ctx, raf: requestAnimationFrame(draw) };
  };

  useEffect(() => {
    return () => {
      stopTimer();
      stopMeter();
      discardRef.current = true;
      const rec = recRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      rec?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const finish = async () => {
    stopTimer();
    stopMeter();
    const rec = recRef.current;
    recRef.current = null;
    rec?.stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];
    const resolvePending = pendingRef.current;
    pendingRef.current = null;
    if (discardRef.current || blob.size < MIN_BLOB_BYTES) {
      setPhase("idle");
      resolvePending?.(null);
      return;
    }
    setPhase("busy");
    try {
      const form = new FormData();
      form.append("file", blob, "dictation.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const json = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || typeof json.text !== "string") {
        onError(json.error ?? "не вдалося розпізнати");
        resolvePending?.(null);
        return;
      }
      const text = json.text.trim();
      if (text) {
        if (resolvePending) resolvePending(text);
        else onUnclaimedText(text);
      } else {
        onError("тиша — нічого не розпізналось");
        resolvePending?.(null);
      }
    } catch {
      onError("сервер недоступний");
      resolvePending?.(null);
    } finally {
      setPhase("idle");
    }
  };

  const start = async () => {
    /* getUserMedia can hang on a permission prompt; a second tap during that
       wait would spin up a second recorder over the first and leak its stream. */
    if (startingRef.current || recRef.current) return;
    startingRef.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    } catch {
      onError("немає доступу до мікрофона");
      return;
    } finally {
      startingRef.current = false;
    }
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    discardRef.current = false;
    rec.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    rec.onstop = () => {
      void finish();
    };
    rec.start(250);
    recRef.current = rec;
    startMeter(stream);
    setElapsed(0);
    setPhase("rec");
    timerRef.current = window.setInterval(() => {
      setElapsed((seconds) => {
        const next = seconds + 1;
        if (next >= MAX_SECONDS && recRef.current?.state === "recording") recRef.current.stop();
        return next;
      });
    }, 1_000);
  };

  const stop = (): Promise<string | null> => {
    return new Promise((resolve) => {
      const rec = recRef.current;
      if (!rec || rec.state !== "recording") {
        resolve(null);
        return;
      }
      pendingRef.current = resolve;
      rec.stop();
    });
  };

  const discard = () => {
    discardRef.current = true;
    if (recRef.current?.state === "recording") recRef.current.stop();
  };

  return { phase, elapsed, canvasRef, start, stop, discard };
}
