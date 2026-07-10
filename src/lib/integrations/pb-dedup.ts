/**
 * Anti-duplicados de Practice Better (bug #2).
 *
 * Antes de crear un paciente en PB, busca por email un record existente para NO
 * duplicar. La búsqueda es LOCAL contra `pb_records_index` (espejo que alimenta
 * el poll poll-practicebetter en cada corrida) → cero requests a PB en el hot
 * path del webhook, que no tolera la latencia ni el rate limit de listar todo.
 *
 * Reglas de oro (Fable red-team):
 *   - C1 (anti-fuga entre clínicas): NUNCA reusar un pb_record_id que YA está
 *     vinculado a OTRO lead. El poll indexa pb_record_id → un solo lead; si dos
 *     leads comparten el record, sus pagos/citas se atribuyen a una marca al
 *     azar = fuga. Si el candidato ya es de otro lead de OTRA marca → no reusar.
 *     Si es de la MISMA marca → ese lead es el dup en CRM; tampoco compartir.
 *   - M2 (carrera): el vínculo a leads.pb_record_id se hace condicional
 *     (solo si aún es NULL). Si perdimos la carrera y ACABÁBAMOS de crear el
 *     record, lo borramos para no dejar un huérfano.
 *   - M4 (varios dups con el mismo email): preferir activo, luego el más antiguo.
 *   - Degrada con gracia: si `pb_records_index` no existe todavía (SQL sin
 *     correr), se comporta como antes (crea sin dedup).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createPbRecord, deletePbRecord, pbId } from "@/lib/integrations/practice-better"

type DB = SupabaseClient<Database>

export type PbLinkInput = {
  leadId: string
  brandId: string
  firstName: string
  lastName?: string | null
  email?: string | null
  phone?: string | null
}

export type PbLinkResult = {
  /** Record final vinculado al lead (reusado o creado). null si no se vinculó. */
  pbRecordId: string | null
  /** true si reusamos un record existente en vez de crear uno nuevo. */
  reused: boolean
  /** true si escribimos leads.pb_record_id en esta llamada. */
  linked: boolean
  /** Motivo cuando NO se vinculó (para logs/UI). */
  skipped?: "cross_brand" | "already_linked" | "no_id" | "lost_race"
}

function normEmail(e?: string | null): string | null {
  const t = (e ?? "").trim().toLowerCase()
  return t.length ? t : null
}

/** Candidatos pb_record_id para un email (activos primero, luego más antiguos). */
async function lookupIndexByEmail(sb: DB, email: string): Promise<string[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (sb as any)
      .from("pb_records_index")
      .select("pb_record_id, is_active, first_seen_at")
      .eq("email_lower", email)
      .order("is_active", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: true })
    if (error) return [] // tabla ausente o RLS → sin dedup (comportamiento de hoy)
    return ((data ?? []) as { pb_record_id: string }[]).map((r) => r.pb_record_id).filter(Boolean)
  } catch {
    return []
  }
}

/** Lead (si existe) que YA posee este pb_record_id. C1: guarda anti-fuga. */
async function leadOwningPbRecord(
  sb: DB,
  recId: string,
): Promise<{ leadId: string; brandId: string } | null> {
  const { data } = await sb
    .from("leads")
    .select("id, brand_id")
    .eq("pb_record_id", recId)
    .limit(1)
    .maybeSingle()
  const row = data as { id: string; brand_id: string } | null
  return row ? { leadId: row.id, brandId: row.brand_id } : null
}

/** Vincula pb_record_id al lead SOLO si aún es NULL (M2). Devuelve si ganó. */
async function linkRecordToLead(sb: DB, leadId: string, recId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any)
    .from("leads")
    .update({ pb_record_id: recId, pb_synced_at: new Date().toISOString() })
    .eq("id", leadId)
    .is("pb_record_id", null)
    .select("id")
  if (error) return false
  return Array.isArray(data) && data.length > 0
}

/**
 * Busca-o-crea el paciente en PB y lo vincula al lead, de forma idempotente y
 * sin duplicar. NUNCA lanza por fallos de PB al caller de un webhook: propaga
 * el error de PB solo si `createPbRecord` falla (el caller ya lo envuelve en
 * try/catch). Devuelve el estado para que el caller loguee o muestre mensaje.
 */
export async function findOrCreatePbRecord(sb: DB, input: PbLinkInput): Promise<PbLinkResult> {
  const email = normEmail(input.email)

  // ── 1) Intentar reusar un record existente por email (índice local) ─────────
  if (email) {
    const candidates = await lookupIndexByEmail(sb, email)
    let sawSameBrand = false
    let sawCrossBrand = false
    for (const recId of candidates) {
      const owner = await leadOwningPbRecord(sb, recId)
      if (owner === null) {
        // Libre → reusar. Vínculo condicional por si otra ejecución lo tomó.
        const won = await linkRecordToLead(sb, input.leadId, recId)
        return won
          ? { pbRecordId: recId, reused: true, linked: true }
          : { pbRecordId: recId, reused: true, linked: false, skipped: "lost_race" }
      }
      // Ocupado: nunca compartir un record entre dos leads (rompe el poll).
      // Seguir buscando un candidato libre antes de rendirse.
      if (owner.brandId === input.brandId) sawSameBrand = true
      else sawCrossBrand = true
    }
    if (sawSameBrand || sawCrossBrand) {
      // Existe(n) record(s) para este email pero todos ocupados → NO crear otro
      // dup. (misma marca = dup en CRM; otra marca = evitar fuga entre clínicas.)
      return {
        pbRecordId: null,
        reused: false,
        linked: false,
        skipped: sawSameBrand ? "already_linked" : "cross_brand",
      }
    }
  }

  // ── 2) No hay candidato reusable → crear ────────────────────────────────────
  const rec = await createPbRecord({
    firstName: input.firstName,
    lastName: input.lastName ?? undefined,
    email: email ?? undefined,
    phone: input.phone ?? undefined,
  })
  const recId = pbId(rec)
  if (!recId) return { pbRecordId: null, reused: false, linked: false, skipped: "no_id" }

  // Vínculo condicional (M2): si perdimos la carrera, borrar el record recién
  // creado para no dejar un huérfano en PB.
  const won = await linkRecordToLead(sb, input.leadId, recId)
  if (!won) {
    try {
      await deletePbRecord(recId)
    } catch {
      /* best-effort: si no se pudo borrar, el poll lo reconciliará por email */
    }
    return { pbRecordId: recId, reused: false, linked: false, skipped: "lost_race" }
  }
  return { pbRecordId: recId, reused: false, linked: true }
}
