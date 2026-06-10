import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { embedTextBatch, MissingOpenAIKeyError } from "@/lib/agent/embeddings"

type SB = SupabaseClient<Database>

const MAX_CALLS_PER_RUN = 10
const CHUNK_SIZE = 1000
const CHUNK_OVERLAP = 100

function isAuthorized(req: NextRequest): boolean {
  // Vercel Cron envía Authorization: Bearer <CRON_SECRET> automáticamente
  // cuando la env var CRON_SECRET existe (mismo mecanismo que poll-800com).
  const auth = req.headers.get("authorization")
  if (!auth) return false
  const secrets = [process.env.INTERNAL_CRON_SECRET, process.env.CRON_SECRET].filter(Boolean)
  return secrets.some((s) => auth === `Bearer ${s}`)
}

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text]
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    chunks.push(text.slice(i, i + CHUNK_SIZE))
    i += CHUNK_SIZE - CHUNK_OVERLAP
  }
  return chunks
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY no configurada — Capa 3 deshabilitada" },
      { status: 503 },
    )
  }

  const sb = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ) as unknown as SB

  // 1) Calls con contenido y SIN embeddings todavía
  const { data: alreadyEmbedded } = await sb
    .from("call_embeddings")
    .select("call_id")
    .not("call_id", "is", null)
  const embeddedSet = new Set((alreadyEmbedded ?? []).map((r) => r.call_id))

  const { data: candidates } = await sb
    .from("calls")
    .select("id, brand_id, transcript_text, ai_summary, notes")
    .order("created_at", { ascending: false })
    .limit(200)

  const toProcess: Array<{ id: string; source: "transcript" | "summary" | "notes"; content: string }> = []
  for (const c of (candidates ?? [])) {
    if (embeddedSet.has(c.id)) continue
    const transcript = (c.transcript_text as string | null) ?? ""
    const summary = (c.ai_summary as string | null) ?? ""
    const notes = (c.notes as string | null) ?? ""
    if (transcript.trim().length >= 20) toProcess.push({ id: c.id, source: "transcript", content: transcript })
    else if (summary.trim().length >= 20) toProcess.push({ id: c.id, source: "summary", content: summary })
    else if (notes.trim().length >= 20) toProcess.push({ id: c.id, source: "notes", content: notes })
    if (toProcess.length >= MAX_CALLS_PER_RUN) break
  }

  if (toProcess.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, embedded_chunks: 0, note: "Nada pendiente" })
  }

  let embeddedChunks = 0
  for (const call of toProcess) {
    try {
      const chunks = chunkText(call.content)
      const vectors = await embedTextBatch(chunks)
      const rows = vectors.map((vec, idx) => ({
        call_id: call.id,
        source: call.source,
        content: chunks[idx],
        embedding: JSON.stringify(vec),
        metadata: { chunk_index: idx, total_chunks: chunks.length },
      }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (sb as any).from("call_embeddings").insert(rows)
      if (error) {
        console.error("[embed-calls] insert error:", error.message, "call:", call.id)
        continue
      }
      embeddedChunks += rows.length
    } catch (e) {
      if (e instanceof MissingOpenAIKeyError) {
        return NextResponse.json({ error: "OPENAI_API_KEY revocada" }, { status: 503 })
      }
      console.error("[embed-calls] call", call.id, "error:", e)
    }
  }

  return NextResponse.json({
    ok: true,
    processed: toProcess.length,
    embedded_chunks: embeddedChunks,
  })
}

export async function POST(req: NextRequest) {
  return handle(req)
}

export async function GET(req: NextRequest) {
  return handle(req)
}
