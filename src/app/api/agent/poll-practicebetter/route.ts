import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeToE164 } from "@/lib/integrations/800com"
import {
  listPbRecords,
  listPbInvoices,
  listPbPackages,
  pbId,
  MissingPbCredentialsError,
  type PbRecord,
  type PbInvoice,
  type PbPackageInstance,
} from "@/lib/integrations/practice-better"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

type DB = SupabaseClient<Database>

// Polling Practice Better → CRM (citas + pagos).
// Patrón idéntico a poll-800com / poll-meta-leads: cron con Bearer CRON_SECRET.
//
// AISLAMIENTO DE MARCA (crítico): Practice Better abarca VARIAS clínicas
// (PRACTICE_BETTER_BRAND_SLUGS = CSV, ej. "sunnyslim,sisepierde,la-esperanza").
// El matching se hace SOLO contra leads de esas marcas. Si un cliente de PB
// coincide con leads en MÁS DE UNA marca (mismo email/tel en 2 clínicas), se
// SALTA en vez de adivinar — así nunca se atribuye a la clínica equivocada.
// El brand de cada cita/pago se HEREDA del lead matcheado. Si la env var no
// está, el cron NO corre.
//
// Rendimiento: traemos los leads de esas marcas UNA vez y matcheamos en
// memoria. Match por pb_record_id, luego email exacto (lowercase), luego
// teléfono E.164. Records sin lead se ignoran.

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization")
  if (!auth) return false
  const secrets = [process.env.CRON_SECRET, process.env.HERMES_SECRET].filter(Boolean)
  return secrets.some((s) => auth === `Bearer ${s}`)
}

// Practice Better entrega los montos YA en centavos (confirmado con datos
// reales 2026-06-25: invoice total.amount = 8500 = $85.00). NO multiplicar.
function toCents(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN
  if (!isFinite(n)) return 0
  return Math.round(n)
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim()
  return null
}

type LeadLite = {
  id: string
  brand_id: string
  email: string | null
  phone: string | null
  pb_record_id: string | null
}

// Trae TODOS los leads de las marcas dadas, paginando (máx 1000/req).
async function fetchLeadsForBrands(sb: DB, brandIds: string[]): Promise<LeadLite[]> {
  const all: LeadLite[] = []
  const pageSize = 1000
  for (let from = 0; from < 50_000; from += pageSize) {
    const { data, error } = await sb
      .from("leads")
      .select("id, brand_id, email, phone, pb_record_id")
      .in("brand_id", brandIds)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`leads fetch: ${error.message}`)
    const rows = (data ?? []) as LeadLite[]
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  return all
}

type Cand = { leadId: string; brandId: string }
// Resuelve candidatos a un único match seguro: si todos comparten brand,
// devuelve el primero; si hay >1 marca distinta, es AMBIGUO → null.
function resolveUnique(cands: Cand[] | undefined): Cand | null {
  if (!cands || cands.length === 0) return null
  const brands = new Set(cands.map((c) => c.brandId))
  if (brands.size > 1) return null // ambiguo entre clínicas: no adivinar
  return cands[0]
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const sb = createAdminClient() as unknown as DB
  const summary = { brands: "", records: 0, matched: 0, payments: 0, appointments: 0, skipped: 0, ambiguous: 0 }

  try {
    // ── 0) Resolver las marcas de Practice Better (CSV) ─────────────────────
    const slugsRaw = process.env.PRACTICE_BETTER_BRAND_SLUGS
    if (!slugsRaw) {
      return NextResponse.json(
        { error: "PRACTICE_BETTER_BRAND_SLUGS no configurada" },
        { status: 503 },
      )
    }
    const slugs = slugsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    const { data: brandRows } = await sb.from("brands").select("id, slug").in("slug", slugs)
    const brandIds = ((brandRows ?? []) as { id: string; slug: string }[]).map((b) => b.id)
    if (brandIds.length === 0) {
      return NextResponse.json(
        { error: `ninguna marca encontrada para '${slugsRaw}'` },
        { status: 503 },
      )
    }
    summary.brands = ((brandRows ?? []) as { slug: string }[]).map((b) => b.slug).join(",")

    // ── 1) Cargar leads de esas marcas e indexar (con detección de ambigüedad)
    const leads = await fetchLeadsForBrands(sb, brandIds)
    const byPbId = new Map<string, Cand>() // pb_record_id → {leadId, brandId}
    const byEmail = new Map<string, Cand[]>() // email lowercase → candidatos
    const byPhone = new Map<string, Cand[]>() // phone E.164 → candidatos
    for (const l of leads) {
      const cand: Cand = { leadId: l.id, brandId: l.brand_id }
      if (l.pb_record_id) byPbId.set(l.pb_record_id, cand)
      if (l.email && l.email.trim()) {
        const k = l.email.trim().toLowerCase()
        byEmail.set(k, [...(byEmail.get(k) ?? []), cand])
      }
      if (l.phone && l.phone.trim()) {
        const k = l.phone.trim()
        byPhone.set(k, [...(byPhone.get(k) ?? []), cand])
      }
    }

    // ── 2) Records de PB → mapa pb_record_id → {leadId, brandId} ────────────
    const records = await listPbRecords()
    summary.records = records.length
    const recordToLead = new Map<string, Cand>()
    const toLink: Array<{ leadId: string; recId: string }> = []
    // Espejo local email→pb_record_id para el anti-duplicados (bug #2). Se
    // alimenta aquí porque ya tenemos TODOS los records listados; el hot path
    // del webhook lo consulta local en vez de listar PB en vivo.
    const indexRows: Array<{
      pb_record_id: string
      email_lower: string | null
      is_active: boolean | null
      updated_at: string
    }> = []

    for (const rec of records as PbRecord[]) {
      const recId = pbId(rec)
      if (!recId) continue

      // Email real: profile.emailAddress (o client.emailAddress). Sin teléfono
      // en el perfil de PB → matcheamos por email.
      const email =
        firstString(rec.profile?.emailAddress, rec.client?.emailAddress)?.toLowerCase() ?? null

      indexRows.push({
        pb_record_id: recId,
        email_lower: email,
        is_active: typeof rec.isActive === "boolean" ? rec.isActive : null,
        updated_at: new Date().toISOString(),
      })

      // pb_record_id es único y seguro; email pasa por resolveUnique que
      // descarta coincidencias ambiguas entre clínicas.
      const linked = byPbId.get(recId) ?? null
      const byEmailMatch = !linked && email ? resolveUnique(byEmail.get(email)) : null
      const match = linked ?? byEmailMatch

      if (!match) {
        const hadEmailCands = email && (byEmail.get(email)?.length ?? 0) > 0
        if (hadEmailCands) summary.ambiguous++
        else summary.skipped++
        continue
      }
      summary.matched++
      recordToLead.set(recId, match)
      if (!byPbId.has(recId)) toLink.push({ leadId: match.leadId, recId })
    }

    // Vincular pb_record_id en los leads que aún no lo tenían
    for (const { leadId, recId } of toLink) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sb as any)
        .from("leads")
        .update({ pb_record_id: recId, pb_synced_at: new Date().toISOString() })
        .eq("id", leadId)
    }

    // Refrescar el espejo local pb_records_index (anti-duplicados, bug #2). En
    // lotes para no exceder límites. Degrada con gracia si la tabla no existe.
    for (let i = 0; i < indexRows.length; i += 500) {
      const batch = indexRows.slice(i, i + 500)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (sb as any)
        .from("pb_records_index")
        .upsert(batch, { onConflict: "pb_record_id" })
      if (error) {
        console.warn("[poll-pb] pb_records_index upsert (no bloqueante):", error.message)
        break // tabla ausente / RLS: no reintentar el resto
      }
    }

    // ── 3) Invoices (pagos) → pb_payments ───────────────────────────────────
    const invoices = await listPbInvoices()
    for (const inv of invoices as PbInvoice[]) {
      const id = pbId(inv)
      const recId = firstString(inv.clientRecord?.id)
      if (!id || !recId) continue
      const match = recordToLead.get(recId)
      if (!match) continue // pago de un cliente sin lead matcheado: ignorar

      const row = {
        brand_id: match.brandId,
        lead_id: match.leadId,
        pb_id: id,
        pb_record_id: recId,
        amount_cents: toCents(inv.total?.amount),
        currency: firstString(inv.currency, inv.total?.currency),
        status: firstString(inv.paymentStatus),
        paid_at: inv.paid ? firstString(inv.invoiceDate, inv.dateModified) : null,
        number: firstString(inv.invoiceNumber),
        raw: inv,
        updated_at: new Date().toISOString(),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (sb as any)
        .from("pb_payments")
        .upsert(row, { onConflict: "pb_id" })
      if (error) console.error("[poll-pb] pago upsert:", error.message)
      else summary.payments++
    }

    // ── 4) Packages (citas) → pb_appointments ───────────────────────────────
    const packages = await listPbPackages()
    for (const pkg of packages as PbPackageInstance[]) {
      const id = pbId(pkg)
      const recId = firstString(pkg.clientRecord?.id)
      if (!id || !recId) continue
      const match = recordToLead.get(recId)
      if (!match) continue

      const row = {
        brand_id: match.brandId,
        lead_id: match.leadId,
        pb_id: id,
        pb_record_id: recId,
        name: firstString(pkg.name),
        status: firstString(pkg.confirmationStatus, pkg.paymentStatus),
        scheduled_at: firstString(pkg.dateCreated, pkg.dateModified),
        raw: pkg,
        updated_at: new Date().toISOString(),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (sb as any)
        .from("pb_appointments")
        .upsert(row, { onConflict: "pb_id" })
      if (error) console.error("[poll-pb] cita upsert:", error.message)
      else summary.appointments++
    }

    return NextResponse.json({ ok: true, ...summary })
  } catch (e) {
    if (e instanceof MissingPbCredentialsError) {
      return NextResponse.json({ error: e.message }, { status: 503 })
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[poll-practicebetter] error:", msg)
    return NextResponse.json({ error: msg, partial: summary }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}
export async function POST(req: NextRequest) {
  return handle(req)
}
