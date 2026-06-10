import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { runReflection } from "@/lib/agent/reflection"

type SB = SupabaseClient<Database>

function isAuthorized(req: NextRequest): boolean {
  // Vercel Cron envía Authorization: Bearer <CRON_SECRET> automáticamente
  // cuando la env var CRON_SECRET existe (mismo mecanismo que poll-800com).
  const auth = req.headers.get("authorization")
  if (!auth) return false
  const secrets = [process.env.INTERNAL_CRON_SECRET, process.env.CRON_SECRET].filter(Boolean)
  return secrets.some((s) => auth === `Bearer ${s}`)
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY no configurada" },
      { status: 503 },
    )
  }

  let brandIdParam: string | null = null
  let sinceHours = 24

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}))
    if (typeof body.brand_id === "string") brandIdParam = body.brand_id
    if (typeof body.since_hours === "number" && body.since_hours > 0) sinceHours = body.since_hours
  } else {
    // GET (cron): default a las últimas 24 horas, todas las marcas activas
    const url = new URL(req.url)
    const qBrand = url.searchParams.get("brand_id")
    if (qBrand) brandIdParam = qBrand
    const qHours = url.searchParams.get("since_hours")
    if (qHours && !Number.isNaN(parseInt(qHours))) sinceHours = parseInt(qHours)
  }

  const sb = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ) as unknown as SB

  const untilIso = new Date().toISOString()
  const sinceIso = new Date(Date.now() - sinceHours * 3600_000).toISOString()

  let brandIds: (string | null)[] = []
  if (brandIdParam) {
    brandIds = [brandIdParam]
  } else {
    const { data: brands } = await sb
      .from("brands")
      .select("id")
      .eq("active", true)
    brandIds = (brands ?? []).map((b) => b.id)
  }

  const results: Array<{ brand_id: string | null; runs_analyzed: number; patterns_detected: number; reflection_id: string | null }> = []
  for (const bid of brandIds) {
    try {
      const r = await runReflection(sb, { brandId: bid, sinceIso, untilIso })
      results.push({ brand_id: bid, ...r })
    } catch (e) {
      console.error("[reflect] brand", bid, "error:", e)
      results.push({ brand_id: bid, runs_analyzed: 0, patterns_detected: 0, reflection_id: null })
    }
  }

  return NextResponse.json({
    ok: true,
    since: sinceIso,
    until: untilIso,
    brands: results,
  })
}

export async function POST(req: NextRequest) {
  return handle(req)
}

export async function GET(req: NextRequest) {
  return handle(req)
}
