/**
 * Empuje de CITAS de Square → sesiones de Practice Better (Fase 3.2/3.3).
 *
 * Al llegar un booking de Square (o vía el importador del apagón), si el lead ya
 * es paciente de PB (pb_record_id) y el servicio está mapeado, creamos la sesión
 * en PB para que el médico la vea en su calendario, con el monto del pago como
 * `fee`. La cita es el evento canónico: NO se crea sesión desde el lado del pago.
 *
 * Reglas de oro:
 *   - Todo detrás de PB_PUSH_SESSIONS (default OFF) → sin la flag, no-op.
 *   - Idempotencia por external_appointments.pb_session_id (llave maestra) + claim
 *     atómico condicional para carreras (mismo patrón que pb-dedup.linkRecordToLead).
 *   - Servicio sin mapear → status 'unmapped' (cola visible), NO se crea sesión.
 *   - booking.updated con sesión existente → reschedule (PUT date), nunca 2° POST.
 *   - status cancelado → cancelar la sesión en PB.
 *   - NUNCA lanza al caller (webhook money/health-critical). Devuelve el estado.
 *   - notify=false, markConfirmed=true (Square ya confirmó y avisó al paciente).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import {
  createPbSession,
  updatePbSessionDate,
  cancelPbSession,
  type PbSessionType,
} from "@/lib/integrations/practice-better"

type DB = SupabaseClient<Database>

const CANCELLED_STATUSES = new Set(["cancelled", "no_show"])
const VALID_TYPES = new Set(["face", "phone", "virtual"])

export type PushPbSessionResult =
  | { status: "off" | "skipped" | "unmapped" | "pushed" | "rescheduled" | "cancelled" | "failed" | "claimed_elsewhere" }

type ServiceMapping = {
  pbServiceId: string
  pbServiceType: PbSessionType
  durationMin: number | null
}

/** Resuelve el mapeo servicio Square → PB (SOLO por ID exacto, activo). */
async function resolveServiceMapping(
  sb: DB,
  squareVariationId: string,
): Promise<ServiceMapping | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from("square_pb_service_map")
    .select("pb_service_id, pb_service_type, duration_min")
    .eq("square_variation_id", squareVariationId)
    .eq("active", true)
    .maybeSingle()
  const row = data as
    | { pb_service_id: string; pb_service_type: string | null; duration_min: number | null }
    | null
  if (!row?.pb_service_id) return null
  const t = (row.pb_service_type ?? "virtual").toLowerCase()
  const pbServiceType = (VALID_TYPES.has(t) ? t : "virtual") as PbSessionType
  return { pbServiceId: row.pb_service_id, pbServiceType, durationMin: row.duration_min ?? null }
}

/** Minutos entre dos ISO (para duración si el mapeo no la fija). */
function minutesBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null
  const a = new Date(startIso).getTime()
  const b = new Date(endIso).getTime()
  if (isNaN(a) || isNaN(b) || b <= a) return null
  return Math.round((b - a) / 60000)
}

type FeeCandidate = { id: string; amountCents: number; currency: string | null }

/**
 * Busca UN pago de Square del mismo cliente en una ventana cercana a la cita para
 * usar su monto como fee. Reglas anti-error (revisor): correlaciona por ventana
 * temporal alrededor de la cita y SOLO devuelve si el candidato es INEQUÍVOCO
 * (exactamente 1 pago cobrado sin aplicar). Con 0 o >1 → null (no adivinar).
 */
async function findFeePayment(
  sb: DB,
  squareCustomerId: string | null,
  startsAt: string | null,
): Promise<FeeCandidate | null> {
  if (!squareCustomerId) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (sb as any)
    .from("external_payments")
    .select("id, amount_cents, currency, status, paid_at")
    .eq("provider", "square")
    .is("pb_fee_applied_to", null)
    // Filtrar status/monto EN el query (no en JS tras el limit) para no perder un
    // pago cobrado legítimo que quedara fuera del top-N por fecha (revisor #3).
    .eq("status", "completed")
    .gt("amount_cents", 0)
    .filter("raw->payment->>customer_id", "eq", squareCustomerId)
  // Ventana: [inicio − 3 días, inicio + 1 día]. El prepago de una consulta cae aquí.
  if (startsAt) {
    const t = new Date(startsAt).getTime()
    if (!isNaN(t)) {
      q = q
        .gte("paid_at", new Date(t - 3 * 24 * 3600 * 1000).toISOString())
        .lte("paid_at", new Date(t + 1 * 24 * 3600 * 1000).toISOString())
    }
  }
  const { data } = await q.order("paid_at", { ascending: false }).limit(5)
  const rows = (data ?? []) as { id: string; amount_cents: number | null; currency: string | null }[]
  // Inequívoco: exactamente 1 candidato cobrado sin aplicar en la ventana. Si hay
  // ambigüedad (0 o >1), mejor sin fee que un fee erróneo.
  if (rows.length !== 1) return null
  const r = rows[0]
  return { id: r.id, amountCents: r.amount_cents ?? 0, currency: r.currency ?? null }
}

/** Reclama un pago para esta sesión de forma ATÓMICA (evita aplicarlo a 2 citas). */
async function claimPayment(sb: DB, paymentId: string, rowId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any)
    .from("external_payments")
    .update({ pb_fee_applied_to: rowId })
    .eq("id", paymentId)
    .is("pb_fee_applied_to", null)
    .select("id")
  if (error) return false
  return Array.isArray(data) && data.length > 0
}

/** Libera un pago reclamado (si createPbSession falla tras reclamarlo). */
async function releasePayment(sb: DB, paymentId: string, rowId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any)
    .from("external_payments")
    .update({ pb_fee_applied_to: null })
    .eq("id", paymentId)
    .eq("pb_fee_applied_to", rowId)
}

export type PushPbSessionParams = {
  /** id de external_appointments (llave para el claim atómico + guardar resultado). */
  rowId: string
  /** lead vinculado (para leer pb_record_id). null → skip. */
  leadId: string | null
  serviceVariationId: string | null
  startsAt: string | null
  endsAt: string | null
  /** status normalizado del booking: booked|pending|cancelled|no_show. */
  status: string | null
  squareCustomerId: string | null
  /** nota extra para la sesión (ej. referencia del booking/tx de Square). */
  sessionNote?: string | null
}

/**
 * Empuja/actualiza/cancela la sesión en PB para una cita de Square. Idempotente
 * y no bloqueante. Devuelve el estado final (también persistido en la fila).
 */
export async function pushPbSession(sb: DB, p: PushPbSessionParams): Promise<PushPbSessionResult> {
  if (process.env.PB_PUSH_SESSIONS !== "true") return { status: "off" }

  try {
    // pb_session_id actual de la fila (si ya se empujó antes).
    const existingPbSessionId = await getRowSessionId(sb, p.rowId)

    // ── Cancelación: si la cita quedó cancelada y ya había sesión → cancelar en PB.
    if (p.status && CANCELLED_STATUSES.has(p.status.toLowerCase())) {
      if (existingPbSessionId) {
        // Respetar el resultado: si PB no canceló, marcar 'failed' (conservando el
        // pb_session_id) para reintentar — nunca decir "cancelada" con la sesión viva.
        const ok = await cancelPbSession(existingPbSessionId)
        await setRow(
          sb,
          p.rowId,
          ok
            ? { pb_session_status: "cancelled", pb_error: null }
            : { pb_session_status: "failed", pb_error: "cancelación en PB falló" },
        )
        return { status: ok ? "cancelled" : "failed" }
      }
      return { status: "skipped" }
    }

    // ── Reschedule: ya hay sesión → actualizar fecha/duración, no crear otra.
    if (existingPbSessionId) {
      const dur = pickDuration(null, p.startsAt, p.endsAt)
      const ok = p.startsAt
        ? await updatePbSessionDate(existingPbSessionId, {
            sessionDate: p.startsAt,
            duration: dur ?? undefined,
          })
        : false
      await setRow(sb, p.rowId, {
        pb_session_status: ok ? "pushed" : "failed",
        pb_error: ok ? null : "reschedule falló",
      })
      return { status: "rescheduled" }
    }

    // ── Requisitos para crear: lead con pb_record_id + servicio mapeado.
    if (!p.leadId) {
      await setRow(sb, p.rowId, { pb_session_status: "skipped" })
      return { status: "skipped" }
    }
    const pbRecordId = await getLeadPbRecordId(sb, p.leadId)
    if (!pbRecordId) {
      await setRow(sb, p.rowId, { pb_session_status: "skipped" })
      return { status: "skipped" }
    }
    if (!p.serviceVariationId) {
      await setRow(sb, p.rowId, { pb_session_status: "unmapped" })
      return { status: "unmapped" }
    }
    const mapping = await resolveServiceMapping(sb, p.serviceVariationId)
    if (!mapping) {
      await setRow(sb, p.rowId, { pb_session_status: "unmapped" })
      return { status: "unmapped" }
    }
    if (!p.startsAt) {
      await setRow(sb, p.rowId, { pb_session_status: "failed", pb_error: "sin fecha de inicio" })
      return { status: "failed" }
    }

    // ── Claim atómico: solo procede quien pone 'pushing' cuando aún no hay sesión.
    const claimed = await claimForPush(sb, p.rowId)
    if (!claimed) return { status: "claimed_elsewhere" }

    // ── Fee: reclamar el pago ATÓMICAMENTE **antes** de crear la sesión, para que
    // el mismo pago NUNCA alimente 2 sesiones (revisor #2). Si otro proceso lo tomó
    // primero, se crea sin fee (el monto igual queda en las notas del record, Fase 2).
    const feeCandidate = await findFeePayment(sb, p.squareCustomerId, p.startsAt)
    let fee: FeeCandidate | null = null
    if (feeCandidate && (await claimPayment(sb, feeCandidate.id, p.rowId))) {
      fee = feeCandidate
    }
    const duration = pickDuration(mapping.durationMin, p.startsAt, p.endsAt) ?? 30

    try {
      const session = await createPbSession({
        clientRecordId: pbRecordId,
        serviceId: mapping.pbServiceId,
        serviceType: mapping.pbServiceType,
        sessionDate: p.startsAt,
        duration,
        fee: fee ? { amount: fee.amountCents, currency: fee.currency ?? "USD" } : null,
        notes: p.sessionNote ?? null,
        notify: false,
        markConfirmed: true,
      })
      const sessionId = session?.id ?? session?._id ?? null
      if (!sessionId) {
        if (fee) await releasePayment(sb, fee.id, p.rowId) // devolver el pago al pool
        await setRow(sb, p.rowId, { pb_session_status: "failed", pb_error: "PB no devolvió sessionId" })
        return { status: "failed" }
      }
      try {
        await setRow(sb, p.rowId, {
          pb_session_id: sessionId,
          pb_session_status: "pushed",
          pb_session_pushed_at: new Date().toISOString(),
          pb_error: null,
          pb_fee_cents: fee?.amountCents ?? null,
          pb_fee_payment_id: fee?.id ?? null,
        })
      } catch (saveErr) {
        // Sesión creada en PB pero falló guardar pb_session_id → HUÉRFANA (fila en
        // 'pushing'). El rescate de 'pushing' stale la reintentaría SIN fee (el pago
        // ya quedó aplicado) → sin impacto monetario, solo cita duplicada visible.
        // Log distintivo para que un humano la detecte. TODO GA: GET de sesiones
        // por clientRecordId+fecha antes de re-crear en el rescate stale.
        console.error(
          `[pb-sessions] ⚠️ HUÉRFANA: sesión ${sessionId} creada en PB pero falló guardar pb_session_id (fila ${p.rowId}):`,
          saveErr instanceof Error ? saveErr.message : String(saveErr),
        )
      }
      return { status: "pushed" }
    } catch (e) {
      if (fee) await releasePayment(sb, fee.id, p.rowId) // devolver el pago al pool
      await setRow(sb, p.rowId, {
        pb_session_status: "failed",
        pb_error: e instanceof Error ? e.message.slice(0, 300) : String(e),
      })
      return { status: "failed" }
    }
  } catch (e) {
    console.warn(
      "[pb-sessions] pushPbSession (no bloqueante):",
      e instanceof Error ? e.message : String(e),
    )
    return { status: "failed" }
  }
}

// ── Helpers de DB ────────────────────────────────────────────────────────────

function pickDuration(
  mappingMin: number | null,
  startsAt: string | null,
  endsAt: string | null,
): number | null {
  if (typeof mappingMin === "number" && mappingMin > 0) return mappingMin
  return minutesBetween(startsAt, endsAt)
}

async function getRowSessionId(sb: DB, rowId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from("external_appointments")
    .select("pb_session_id")
    .eq("id", rowId)
    .maybeSingle()
  return (data as { pb_session_id: string | null } | null)?.pb_session_id ?? null
}

async function getLeadPbRecordId(sb: DB, leadId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from("leads")
    .select("pb_record_id")
    .eq("id", leadId)
    .maybeSingle()
  return (data as { pb_record_id: string | null } | null)?.pb_record_id ?? null
}

/**
 * Claim atómico en DOS pasos (evita el `.or` con `and()` anidado de PostgREST,
 * frágil). El guard `.is('pb_session_id', null)` impide re-crear si la sesión ya
 * se guardó, en ambos pasos.
 *   1) Estados reclamables directos: null | failed | unmapped | skipped.
 *   2) Rescate de 'pushing' STALE (claim de hace >10 min = un proceso murió a
 *      mitad) → así una fila NUNCA queda colgada en 'pushing' sin recuperación.
 */
async function claimForPush(sb: DB, rowId: string): Promise<boolean> {
  const now = new Date().toISOString()
  const patch = { pb_session_status: "pushing", pb_claimed_at: now }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const first = await (sb as any)
    .from("external_appointments")
    .update(patch)
    .eq("id", rowId)
    .is("pb_session_id", null)
    .or("pb_session_status.is.null,pb_session_status.in.(failed,unmapped,skipped)")
    .select("id")
  if (!first.error && Array.isArray(first.data) && first.data.length > 0) return true

  // Sin milisegundos (PostgREST usa '.' como separador de operador en `.or`).
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const second = await (sb as any)
    .from("external_appointments")
    .update(patch)
    .eq("id", rowId)
    .is("pb_session_id", null)
    .eq("pb_session_status", "pushing")
    // pb_claimed_at NULL también es reclamable (fila pre-migración): NULL < x = NULL.
    .or(`pb_claimed_at.is.null,pb_claimed_at.lt.${staleCutoff}`)
    .select("id")
  return !second.error && Array.isArray(second.data) && second.data.length > 0
}

async function setRow(sb: DB, rowId: string, patch: Record<string, unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any).from("external_appointments").update(patch).eq("id", rowId)
}
