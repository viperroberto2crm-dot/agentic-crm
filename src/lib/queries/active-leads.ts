import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type SB = SupabaseClient<Database>

// Estados de pago liquidado (mismo criterio que coverage). Pagos fallidos o
// reembolsados NO cuentan como "vino/pagó".
const SETTLED = new Set(["completed", "paid", "settled", "succeeded"])
// Citas que NO cuentan como "vino".
const DEAD_APPT = new Set(["cancelled", "canceled", "no_show", "no-show"])

const PAGE = 1000

/**
 * Trae TODAS las filas de una consulta paginando de 1000 en 1000 (el default de
 * Supabase corta a 1000). Devuelve las filas o [] (y registra el error, no lo
 * traga en silencio → Fable #2/#6).
 */
async function fetchAllRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildPage: (from: number, to: number) => any,
  label: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await buildPage(from, from + PAGE - 1)
    if (error) {
      console.error(`[activeLeadIds] ${label}:`, error.message)
      break
    }
    const rows = (data ?? []) as Record<string, unknown>[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

/**
 * IDs de pacientes con ACTIVIDAD dentro de un rango [startIso, endIso) UTC:
 * entraron (lead creado), tuvieron una venta, un pago liquidado de Stripe/Square,
 * o una cita (no cancelada). Para que el filtro de fecha muestre a quien
 * "vino/pagó", no solo a quien se dio de alta. Cliente de SESIÓN → RLS por marca.
 */
export async function activeLeadIdsInRange(
  sb: SB,
  startIso: string,
  endIso: string,
): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = sb as any
  const ids = new Set<string>()

  // order("id") = desempate estable en la paginación (created_at empatado en
  // imports masivos → sin desempate se saltan/duplican filas; Fable #4).
  const [leadRows, saleRows, extRows, apptRows, abonoRows] = await Promise.all([
    fetchAllRows(
      (f, t) => q.from("leads").select("id").gte("created_at", startIso).lt("created_at", endIso)
        .order("id", { ascending: true }).range(f, t),
      "leads",
    ),
    // Ventas por fecha de registro (created_at) → cuenta pagadas Y pendientes.
    fetchAllRows(
      (f, t) => q.from("sales").select("lead_id, id").not("lead_id", "is", null)
        .gte("created_at", startIso).lt("created_at", endIso).order("id", { ascending: true }).range(f, t),
      "sales",
    ),
    fetchAllRows(
      (f, t) => q.from("external_payments").select("lead_id, status, id").not("lead_id", "is", null)
        .gte("paid_at", startIso).lt("paid_at", endIso).order("id", { ascending: true }).range(f, t),
      "external_payments",
    ),
    fetchAllRows(
      (f, t) => q.from("appointments").select("lead_id, status, id").not("lead_id", "is", null)
        .gte("scheduled_at", startIso).lt("scheduled_at", endIso).order("id", { ascending: true }).range(f, t),
      "appointments",
    ),
    // Abonos (pagos de plan) por fecha de pago → cuenta a quien pagó su plan en
    // el periodo aunque no tenga cita/venta nueva (Fable #5).
    fetchAllRows(
      (f, t) => q.from("abonos").select("lead_id, id").not("lead_id", "is", null)
        .gte("paid_at", startIso).lt("paid_at", endIso).order("id", { ascending: true }).range(f, t),
      "abonos",
    ),
  ])

  for (const r of leadRows) {
    const v = r.id
    if (typeof v === "string" && v) ids.add(v)
  }
  for (const r of saleRows) {
    const v = r.lead_id
    if (typeof v === "string" && v) ids.add(v)
  }
  for (const r of extRows) {
    // Solo pagos LIQUIDADOS (no fallidos/reembolsados).
    if (!SETTLED.has(((r.status as string | null) ?? "").toLowerCase())) continue
    const v = r.lead_id
    if (typeof v === "string" && v) ids.add(v)
  }
  for (const r of apptRows) {
    // Excluye citas canceladas / no-show.
    if (DEAD_APPT.has(((r.status as string | null) ?? "").toLowerCase())) continue
    const v = r.lead_id
    if (typeof v === "string" && v) ids.add(v)
  }
  for (const r of abonoRows) {
    const v = r.lead_id
    if (typeof v === "string" && v) ids.add(v)
  }

  return Array.from(ids)
}
