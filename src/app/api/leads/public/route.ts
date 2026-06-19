import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeToE164 } from "@/lib/integrations/800com"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DB = SupabaseClient<Database>

// Endpoint público para capturar leads desde landing pages externas
// (ej. clinicamedicalaesperanza.com). Auth por header x-api-key.
// Los leads entran al pool (assigned_rep_id=null) con status="new".

// Orígenes permitidos para CORS. Agregar aquí nuevos dominios de landing.
const ALLOWED_ORIGINS = new Set<string>([
  "https://clinicamedicalaesperanza.com",
  "https://www.clinicamedicalaesperanza.com",
])

function corsHeaders(origin: string | null): Record<string, string> {
  // Si el origin está en la allowlist lo reflejamos; si no, devolvemos el
  // dominio principal (el navegador bloqueará orígenes no permitidos).
  const allowed = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://clinicamedicalaesperanza.com"
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}

// Preflight CORS
export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin")
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin")
  const cors = corsHeaders(origin)

  // 1) Auth: header secreto compartido
  const expected = process.env.LANDING_LEAD_API_KEY
  if (!expected) {
    console.error("[leads/public] LANDING_LEAD_API_KEY no configurada")
    return NextResponse.json({ ok: false, error: "not configured" }, { status: 500, headers: cors })
  }
  const provided = request.headers.get("x-api-key")
  if (provided !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: cors })
  }

  // 2) Parsear body
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400, headers: cors })
  }

  const name = typeof body.name === "string" ? body.name.trim() : ""
  const phoneRaw = typeof body.phone === "string" ? body.phone.trim() : ""
  const email = typeof body.email === "string" ? body.email.trim() : ""
  const suero = typeof body.suero === "string" ? body.suero.trim() : ""
  const sourceRaw = typeof body.source === "string" ? body.source.trim() : "landing"
  const lang = typeof body.lang === "string" ? body.lang.trim() : ""
  const createdAt = typeof body.createdAt === "string" ? body.createdAt.trim() : ""

  // Requerimos al menos un nombre y un medio de contacto
  if (!name && !phoneRaw && !email) {
    return NextResponse.json(
      { ok: false, error: "missing name/phone/email" },
      { status: 400, headers: cors },
    )
  }

  const sb = createAdminClient() as unknown as DB

  // 3) Resolver brand: env slug → fallback al primer brand activo
  const brandSlug = process.env.LANDING_LEAD_BRAND_SLUG ?? null
  let brandId: string | null = null
  if (brandSlug) {
    const { data } = await sb.from("brands").select("id").eq("slug", brandSlug).maybeSingle()
    brandId = (data as { id: string } | null)?.id ?? null
  }
  if (!brandId) {
    const { data } = await sb
      .from("brands")
      .select("id")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
    brandId = (data as { id: string } | null)?.id ?? null
  }
  if (!brandId) {
    console.error("[leads/public] no se pudo resolver brand_id")
    return NextResponse.json({ ok: false, error: "no brand" }, { status: 500, headers: cors })
  }

  // 4) Normalizar nombre y teléfono
  const parts = name.split(/\s+/).filter(Boolean)
  const firstName = parts.length ? parts[0] : "(Sin nombre)"
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null
  const phone = phoneRaw ? normalizeToE164(phoneRaw) || phoneRaw : null

  // 5) Dedup dentro del brand: por email, luego por teléfono (patrón Meta).
  //    Si ya existe, NO duplicamos; devolvemos ok igual para no romper el form.
  try {
    if (email) {
      const { data: byEmail } = await sb
        .from("leads")
        .select("id")
        .eq("brand_id", brandId)
        .ilike("email", email)
        .maybeSingle()
      if (byEmail) {
        return NextResponse.json({ ok: true, deduped: true }, { status: 200, headers: cors })
      }
    }
    if (phone) {
      const { data: byPhone } = await sb
        .from("leads")
        .select("id")
        .eq("brand_id", brandId)
        .eq("phone", phone)
        .maybeSingle()
      if (byPhone) {
        return NextResponse.json({ ok: true, deduped: true }, { status: 200, headers: cors })
      }
    }
  } catch (e) {
    // Si el dedup falla, seguimos al insert (mejor un posible duplicado que perder el lead)
    console.warn("[leads/public] dedup check falló:", e instanceof Error ? e.message : String(e))
  }

  // 6) Notas legibles + datos crudos en custom_fields
  const notesLines = [
    suero ? `Suero de interés: ${suero}` : null,
    `Fuente landing: ${sourceRaw}`,
    lang ? `Idioma: ${lang}` : null,
    createdAt ? `Enviado: ${createdAt}` : null,
  ].filter(Boolean)

  const customFields = {
    landing_suero: suero || null,
    landing_source: sourceRaw,
    landing_lang: lang || null,
    landing_created_at: createdAt || null,
  }

  // 7) Insert
  const { error } = await sb.from("leads").insert({
    brand_id: brandId,
    first_name: firstName,
    last_name: lastName,
    email: email || null,
    phone,
    status: "new",
    source: "web_form",
    external_provider: "landing",
    assigned_rep_id: null,
    notes: notesLines.join("\n"),
    custom_fields: customFields,
  })

  if (error) {
    console.error("[leads/public] insert error:", error.message)
    return NextResponse.json({ ok: false, error: "insert failed" }, { status: 500, headers: cors })
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: cors })
}
