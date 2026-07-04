"use client";

import { useEffect, useRef, useState } from "react";

import { Loader2, Mic, X } from "@/components/icons";

type Phase = "idle" | "rec" | "busy";

const MAX_SECONDS = 120;
/* Sub-2KB blobs are a misclick, not speech — dropped without a server call. */
const MIN_BLOB_BYTES = 2_000;

const METER_BARS = 13;
const METER_WIDTH = 56;
const METER_HEIGHT = 16;
/* Voice energy lives in the lower spectrum; the top bins of a 64-bin FFT stay
   near zero and would render as permanently dead bars. */
const METER_SPECTRUM_SHARE = 0.65;

function fmtElapsed(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function drawMeter(canvas: HTMLCanvasElement, bins: Uint8Array): void {
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

/**
 * Dictation button for composers: press to record (getUserMedia + MediaRecorder,
 * webm/opus), press again to stop and transcribe through /api/transcribe, which
 * proxies to the ChatGPT backend with the local Codex credentials.
 */
export function MicButton({ onText, onError }: { onText: (text: string) => void; onError: (message: string) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meterRef = useRef<{ ctx: AudioContext; raf: number } | null>(null);

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
    if (discardRef.current || blob.size < MIN_BLOB_BYTES) {
      setPhase("idle");
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
        return;
      }
      const text = json.text.trim();
      if (text) onText(text);
      else onError("тиша — нічого не розпізналось");
    } catch {
      onError("сервер недоступний");
    } finally {
      setPhase("idle");
    }
  };

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    } catch {
      onError("немає доступу до мікрофона");
      return;
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

  const handleMain = () => {
    if (phase === "idle") void start();
    else if (phase === "rec" && recRef.current?.state === "recording") recRef.current.stop();
  };

  const handleDiscard = () => {
    discardRef.current = true;
    if (recRef.current?.state === "recording") recRef.current.stop();
  };

  if (phase === "rec") {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label="Зупинити запис і розпізнати"
          onClick={handleMain}
          className="flex items-center gap-1.5 rounded-[8px] border border-err/50 bg-[#fff2f2] px-2 py-1 text-[11px] font-bold text-err focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-err/40"
        >
          <canvas
            ref={canvasRef}
            width={METER_WIDTH}
            height={METER_HEIGHT}
            className="h-4 w-14"
            aria-hidden
          />
          {fmtElapsed(elapsed)}
        </button>
        <button
          type="button"
          aria-label="Скасувати запис"
          onClick={handleDiscard}
          className="inline-flex items-center rounded-[8px] border border-line bg-panel px-1.5 py-1 text-dim hover:text-err focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={phase === "busy" ? "Розпізнаю…" : "Надиктувати"}
      title={phase === "busy" ? "розпізнаю…" : "надиктувати (до 2 хв)"}
      disabled={phase === "busy"}
      onClick={handleMain}
      className="inline-flex shrink-0 items-center rounded-[8px] border border-line bg-panel px-2 py-1 text-dim hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
    >
      {phase === "busy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
    </button>
  );
}
