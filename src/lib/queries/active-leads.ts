import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type SB = SupabaseClient<Database>

/**
 * IDs de pacientes con ACTIVIDAD dentro de un rango [startIso, endIso) UTC:
 * entraron (lead creado), pagaron (venta o pago Stripe/Square), o tuvieron cita.
 * Sirve para que el filtro de fecha de la lista muestre a quien "vino/pagó" en el
 * periodo, no solo a quien se dio de alta ese día. (Una simple llamada NO cuenta
 * como "vino"; el lead nuevo por llamada ya se cuenta por su fecha de alta.)
 *
 * Corre con el cliente de SESIÓN → respeta RLS (solo ve lo de sus marcas). Aun
 * así fetchLeads vuelve a filtrar por marca sobre estos IDs (defensa doble).
 */
export async function activeLeadIdsInRange(
  sb: SB,
  startIso: string,
  endIso: string,
): Promise<string[]> {
  const ids = new Set<string>()
  const collect = (rows: unknown, key: string) => {
    for (const r of (rows as Record<string, unknown>[] | null) ?? []) {
      const v = r[key]
      if (typeof v === "string" && v) ids.add(v)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = sb as any
  const [leadsR, salesR, extR, apptR] = await Promise.all([
    q.from("leads").select("id").gte("created_at", startIso).lt("created_at", endIso),
    q.from("sales").select("lead_id").not("lead_id", "is", null)
      .gte("paid_at", startIso).lt("paid_at", endIso),
    q.from("external_payments").select("lead_id").not("lead_id", "is", null)
      .gte("paid_at", startIso).lt("paid_at", endIso),
    q.from("appointments").select("lead_id").not("lead_id", "is", null)
      .gte("scheduled_at", startIso).lt("scheduled_at", endIso),
  ])

  collect(leadsR?.data, "id")
  collect(salesR?.data, "lead_id")
  collect(extR?.data, "lead_id")
  collect(apptR?.data, "lead_id")

  return Array.from(ids)
}
