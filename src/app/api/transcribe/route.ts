import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { readCodexAuth } from "@/lib/codexAuth";
import { rejectCrossOrigin } from "@/lib/sameOrigin";
import { callTranscribe } from "@/lib/transcribe/chatgpt";
import { elevenLabsTranscribe } from "@/lib/transcribe/elevenlabs";
import { localTranscribe } from "@/lib/transcribe/local";
import type { TranscribeResponse } from "@/lib/transcribe/types";
import { readElevenLabsApiKey, resolveTranscribeBackend } from "@/lib/transcribeBackend";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const LANGUAGE_RE = /^[a-z]{2}(?:-[A-Z]{2})?$/;

export async function POST(req: NextRequest): Promise<NextResponse<TranscribeResponse | ApiError>> {
  const rejection = rejectCrossOrigin(req);
  if (rejection) return rejection;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "очікується multipart/form-data з полем file" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "нема аудіофайла в полі file" }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "аудіо завелике (ліміт 16 МБ)" }, { status: 413 });
  }
  const mime = file.type && file.type.startsWith("audio/") ? file.type.split(";")[0] : "audio/webm";
  if (file.type && !file.type.startsWith("audio/")) {
    return NextResponse.json({ error: "очікується аудіо" }, { status: 415 });
  }
  const rawLanguage = form.get("language");
  const language = typeof rawLanguage === "string" && LANGUAGE_RE.test(rawLanguage) ? rawLanguage : "";
  const backend = resolveTranscribeBackend();

  if (backend === "elevenlabs") {
    const apiKey = readElevenLabsApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: "нема ключа ElevenLabs (~/.config/agent-log-viewer/elevenlabs-api-key або ELEVENLABS_API_KEY)" },
        { status: 503 },
      );
    }
    try {
      return NextResponse.json(await elevenLabsTranscribe(apiKey, file, language));
    } catch (error) {
      return NextResponse.json(
        { error: `ElevenLabs STT: ${error instanceof Error ? error.message : String(error)}` },
        { status: 502 },
      );
    }
  }

  const tmpPath = path.join(os.tmpdir(), `viewer-dictation-${Date.now()}-${Math.floor(Math.random() * 1e6)}.webm`);
  try {
    fs.writeFileSync(tmpPath, Buffer.from(await file.arrayBuffer()));

    if (backend === "local") {
      const result = await localTranscribe(tmpPath, language);
      return NextResponse.json(result);
    }

    const auth = readCodexAuth();
    if (!auth) {
      return NextResponse.json(
        { error: "нема ChatGPT-токена Codex (~/.codex/auth.json) — залогінься в Codex" },
        { status: 503 },
      );
    }
    const upstream = await callTranscribe(auth, tmpPath, mime, language);
    if (upstream.status === 401) {
      return NextResponse.json({ error: "ChatGPT-токен протух — відкрий Codex, щоб він оновив токен" }, { status: 502 });
    }
    if (upstream.status !== 200) {
      return NextResponse.json({ error: `бекенд транскрипції: HTTP ${upstream.status || "0 (мережа)"}` }, { status: 502 });
    }
    const json = JSON.parse(upstream.body) as { text?: unknown };
    return NextResponse.json({ text: typeof json.text === "string" ? json.text : "" });
  } catch (error) {
    const label = backend === "local" ? "локальний STT" : "бекенд транскрипції";
    return NextResponse.json(
      { error: `${label}: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}
