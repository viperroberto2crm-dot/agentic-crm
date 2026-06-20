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
// Flujo:
//   1) Traer records (clientes) de PB.
//   2) Para cada record, matchear con un lead del CRM por pb_record_id,
//      email o teléfono. Si matchea, guardar pb_record_id en el lead.
//   3) Traer invoices (pagos) y packages (citas); upsert en pb_payments /
//      pb_appointments vinculados al lead correspondiente. El brand se HEREDA
//      del lead matcheado (nunca se mezclan marcas).
//   Records sin lead correspondiente se IGNORAN (no creamos leads automáticos
//      para evitar ruido; decisión del diseño 2026-06-09).

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization")
  if (!auth) return false
  const secrets = [process.env.CRON_SECRET, process.env.HERMES_SECRET].filter(Boolean)
  return secrets.some((s) => auth === `Bearer ${s}`)
}

function toCents(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN
  if (!isFinite(n)) return 0
  return Math.round(n * 100)
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim()
  return null
}

type LeadMatch = { lead_id: string; brand_id: string }

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const sb = createAdminClient() as unknown as DB
  const summary = { records: 0, matched: 0, payments: 0, appointments: 0, skipped: 0 }

  try {
    // ── 1) Records de PB → mapa pb_record_id → {lead_id, brand_id} ──────────
    const records = await listPbRecords()
    summary.records = records.length
    const recordToLead = new Map<string, LeadMatch>()

    for (const rec of records as PbRecord[]) {
      const recId = pbId(rec)
      if (!recId) continue

      const email = firstString(rec.email)
      const phoneRaw = firstString(rec.phone, rec.mobile)
      const phone = phoneRaw ? normalizeToE164(phoneRaw) || phoneRaw : null

      // Buscar lead: por pb_record_id ya vinculado, luego email, luego teléfono
      let match: LeadMatch | null = null

      const { data: byPb } = await sb
        .from("leads")
        .select("id, brand_id")
        .eq("pb_record_id", recId)
        .maybeSingle()
      if (byPb) match = { lead_id: byPb.id, brand_id: byPb.brand_id }

      if (!match && email) {
        const { data } = await sb
          .from("leads")
          .select("id, brand_id")
          .ilike("email", email)
          .limit(1)
          .maybeSingle()
        if (data) match = { lead_id: data.id, brand_id: data.brand_id }
      }
      if (!match && phone) {
        const { data } = await sb
          .from("leads")
          .select("id, brand_id")
          .eq("phone", phone)
          .limit(1)
          .maybeSingle()
        if (data) match = { lead_id: data.id, brand_id: data.brand_id }
      }

      if (!match) {
        summary.skipped++
        continue
      }
      summary.matched++
      recordToLead.set(recId, match)

      // Vincular pb_record_id al lead (si aún no lo tiene)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sb as any)
        .from("leads")
        .update({ pb_record_id: recId, pb_synced_at: new Date().toISOString() })
        .eq("id", match.lead_id)
    }

    // ── 2) Invoices (pagos) → pb_payments ───────────────────────────────────
    const invoices = await listPbInvoices()
    for (const inv of invoices as PbInvoice[]) {
      const id = pbId(inv)
      const recId = firstString(inv.recordId, inv.clientId)
      if (!id || !recId) continue
      const match = recordToLead.get(recId)
      if (!match) continue // pago de un cliente sin lead en el CRM: ignorar

      const row = {
        brand_id: match.brand_id,
        lead_id: match.lead_id,
        pb_id: id,
        pb_record_id: recId,
        amount_cents: toCents(inv.total ?? inv.amount),
        currency: firstString(inv.currency),
        status: firstString(inv.status),
        paid_at: firstString(inv.paidDate, inv.date),
        number: firstString(inv.number),
        raw: inv,
        updated_at: new Date().toISOString(),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (sb as any)
        .from("pb_payments")
        .upsert(row, { onConflict: "pb_id" })
      if (!error) summary.payments++
    }

    // ── 3) Packages (citas) → pb_appointments ───────────────────────────────
    const packages = await listPbPackages()
    for (const pkg of packages as PbPackageInstance[]) {
      const id = pbId(pkg)
      const recId = firstString(pkg.recordId, pkg.clientId)
      if (!id || !recId) continue
      const match = recordToLead.get(recId)
      if (!match) continue

      const row = {
        brand_id: match.brand_id,
        lead_id: match.lead_id,
        pb_id: id,
        pb_record_id: recId,
        name: firstString(pkg.name),
        status: firstString(pkg.status),
        scheduled_at: firstString(pkg.scheduledAt, pkg.startDate),
        raw: pkg,
        updated_at: new Date().toISOString(),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (sb as any)
        .from("pb_appointments")
        .upsert(row, { onConflict: "pb_id" })
      if (!error) summary.appointments++
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
