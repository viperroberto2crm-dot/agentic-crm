/**
 * Cron: transcribe pending call recordings via OpenAI Whisper.
 *
 * Picks up calls where transcription_status='pending' AND recording_url IS NOT NULL,
 * downloads the audio (trying 800.com bearer auth first, then anonymous fallback),
 * sends to Whisper, and stores the transcript text on the row.
 *
 * Designed to run every 5 minutes (alternated with poll-800com which runs every 3).
 * Processes up to 10 calls per invocation to stay well within Vercel's 60s ceiling
 * and OpenAI tier-1 rate limits (~50 req/min).
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

export const runtime = "nodejs"
export const maxDuration = 60

// OpenAI Whisper hard cap on upload size.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const BATCH_SIZE = 10

type CallRow = {
  id: string
  recording_url: string | null
  source: string | null
  called_at: string | null
}

type ResultJson = {
  ok: boolean
  processed: number
  failed: number
  skipped: number
  duration_ms: number
  errors: { call_id: string; error: string }[]
}

/**
 * Download the recording from 800.com. We try with the bearer token first
 * (some recording URLs are gated by the same API key), and fall back to an
 * anonymous fetch if 401/403 — public/signed URLs do not accept extra auth
 * headers gracefully on every CDN. 404 is terminal.
 */
async function downloadRecording(
  url: string,
): Promise<{ blob: Blob; contentType: string } | { error: string }> {
  const apiKey = process.env.EIGHTHUNDRED_API_KEY

  const attempts: Array<{ label: string; headers: Record<string, string> }> = []
  if (apiKey) {
    attempts.push({
      label: "with-auth",
      headers: { authorization: `Bearer ${apiKey}` },
    })
  }
  attempts.push({ label: "anonymous", headers: {} })

  let lastStatus = 0
  let lastBody = ""

  for (const attempt of attempts) {
    const res = await fetch(url, {
      headers: attempt.headers,
      cache: "no-store",
      redirect: "follow",
    })
    if (res.ok) {
      const contentType = res.headers.get("content-type") ?? "audio/mpeg"
      const blob = await res.blob()
      return { blob, contentType }
    }
    lastStatus = res.status
    lastBody = await res.text().catch(() => "")
    // 401/403 → retry without auth (next iteration). Other codes → bail.
    if (res.status !== 401 && res.status !== 403) break
  }

  return {
    error: `download failed ${lastStatus}: ${lastBody.slice(0, 200)}`,
  }
}

/**
 * Send audio to OpenAI Whisper. Returns the transcript text or an error.
 */
async function transcribeWithWhisper(
  audio: Blob,
  contentType: string,
  apiKey: string,
): Promise<{ text: string } | { error: string }> {
  // Pick a sensible filename + extension from the content type so Whisper
  // accepts the upload (the API uses extension to detect format).
  let ext = "mp3"
  if (contentType.includes("wav")) ext = "wav"
  else if (contentType.includes("m4a") || contentType.includes("mp4")) ext = "m4a"
  else if (contentType.includes("ogg")) ext = "ogg"
  else if (contentType.includes("webm")) ext = "webm"
  else if (contentType.includes("flac")) ext = "flac"

  const file = new File([audio], `recording.${ext}`, { type: contentType })

  const form = new FormData()
  form.append("file", file)
  form.append("model", "whisper-1")
  // Hint Spanish for accuracy — most reps/leads are ES speakers. Whisper still
  // handles EN via language detection if the audio is actually English.
  form.append("language", "es")

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    return { error: `whisper ${res.status}: ${body.slice(0, 300)}` }
  }

  const json = (await res.json()) as { text?: string }
  if (typeof json.text !== "string") {
    return { error: "whisper response missing .text" }
  }
  return { text: json.text }
}

export async function GET(req: NextRequest) {
  const t0 = Date.now()

  try {
    const expected = process.env.CRON_SECRET
    if (!expected) {
      return NextResponse.json(
        { error: "CRON_SECRET not configured" },
        { status: 500 },
      )
    }
    const auth = req.headers.get("authorization") ?? ""
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return NextResponse.json(
        { error: "Supabase env vars missing" },
        { status: 500 },
      )
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 500 },
      )
    }
    const openaiKey = process.env.OPENAI_API_KEY

    const sb = createServiceClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    // `transcription_status` is a runtime column not yet reflected in the
    // generated Database types — same gap that 800com.ts works around. We
    // narrow via an explicit row type for safety.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pending, error: selErr } = await (sb as any)
      .from("calls")
      .select("id, recording_url, source, called_at")
      .eq("transcription_status", "pending")
      .not("recording_url", "is", null)
      .order("called_at", { ascending: false })
      .limit(BATCH_SIZE)

    if (selErr) {
      return NextResponse.json(
        { error: `select pending failed: ${selErr.message}` },
        { status: 500 },
      )
    }

    const rows = (pending ?? []) as CallRow[]

    const result: ResultJson = {
      ok: true,
      processed: 0,
      failed: 0,
      skipped: 0,
      duration_ms: 0,
      errors: [],
    }

    for (const call of rows) {
      if (!call.recording_url) {
        // Defensive: filtered out by query but just in case.
        result.skipped++
        continue
      }

      // Optimistic lock: flip to 'processing' so a parallel run doesn't pick
      // the same row. If the update changes 0 rows (race), skip.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: lockErr } = await (sb as any)
        .from("calls")
        .update({ transcription_status: "processing" })
        .eq("id", call.id)
        .eq("transcription_status", "pending")

      if (lockErr) {
        result.failed++
        result.errors.push({ call_id: call.id, error: `lock: ${lockErr.message}` })
        continue
      }

      try {
        const dl = await downloadRecording(call.recording_url)
        if ("error" in dl) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (sb as any)
            .from("calls")
            .update({ transcription_status: "failed" })
            .eq("id", call.id)
          result.failed++
          result.errors.push({ call_id: call.id, error: dl.error })
          console.error(`[transcribe-calls] ${call.id} download:`, dl.error)
          continue
        }

        if (dl.blob.size > MAX_AUDIO_BYTES) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (sb as any)
            .from("calls")
            .update({
              transcription_status: "skipped",
              notes: `Audio ${dl.blob.size} bytes > 25MB Whisper cap — skipped`,
            })
            .eq("id", call.id)
          result.skipped++
          continue
        }

        if (dl.blob.size === 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (sb as any)
            .from("calls")
            .update({ transcription_status: "failed" })
            .eq("id", call.id)
          result.failed++
          result.errors.push({ call_id: call.id, error: "empty audio body" })
          continue
        }

        const tr = await transcribeWithWhisper(dl.blob, dl.contentType, openaiKey)
        if ("error" in tr) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (sb as any)
            .from("calls")
            .update({ transcription_status: "failed" })
            .eq("id", call.id)
          result.failed++
          result.errors.push({ call_id: call.id, error: tr.error })
          console.error(`[transcribe-calls] ${call.id} whisper:`, tr.error)
          continue
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updErr } = await (sb as any)
          .from("calls")
          .update({
            transcript_text: tr.text,
            transcription_status: "done",
          })
          .eq("id", call.id)

        if (updErr) {
          result.failed++
          result.errors.push({
            call_id: call.id,
            error: `save transcript: ${updErr.message}`,
          })
          continue
        }

        result.processed++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (sb as any)
          .from("calls")
          .update({ transcription_status: "failed" })
          .eq("id", call.id)
          .then(() => null, () => null)
        result.failed++
        result.errors.push({ call_id: call.id, error: msg })
        console.error(`[transcribe-calls] ${call.id} exception:`, msg)
      }
    }

    result.duration_ms = Date.now() - t0
    result.ok = result.failed === 0
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null
    console.error("[transcribe-calls] uncaught:", msg, stack)
    return NextResponse.json(
      {
        error: msg,
        stack: stack?.split("\n").slice(0, 5).join("\n"),
        duration_ms: Date.now() - t0,
      },
      { status: 500 },
    )
  }
}
