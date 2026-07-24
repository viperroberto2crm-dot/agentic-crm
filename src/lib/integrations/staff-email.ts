import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { escapeIlike } from "@/lib/queries/search"

type DB = SupabaseClient<Database>

/**
 * ¿Este email pertenece a un usuario del staff (rep/manager/admin/provider)?
 *
 * Los pagos externos (Square/Stripe) a veces llegan con el email de la vendedora:
 * la rep corre la tarjeta bajo su propia cuenta, o el navegador autocompleta su
 * correo al crear el lead. Ese email de staff queda pegado a un lead y se vuelve
 * un "imán" que absorbe pagos de OTRAS pacientes sobre el lead equivocado
 * (bug real: 12 pagos de 2 personas apilados en un solo lead vía andreina@...).
 *
 * Regla: NUNCA enlazar un pago a un lead usando un email de staff. Los llamadores
 * saltan el match-por-email cuando esto devuelve true y caen al match por teléfono.
 *
 * Falla-CERRADO hacia lo seguro: si la consulta de `users` truena (timeout, RLS,
 * pool agotado en un pico), tratamos el email como "desconocido" y devolvemos true
 * → se salta el match-por-email y se cae a teléfono (resultado recuperable: el pago
 * queda Sin Vincular en el peor caso). Nunca dejamos que un error transitorio reabra
 * el imán de pagos. Un resultado vacío legítimo (0 filas) sí devuelve false: no es
 * staff, el email de la paciente real matchea normal.
 */
export async function isStaffEmail(sb: DB, email: string | null): Promise<boolean> {
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return false
  const { data, error } = await sb
    .from("users")
    .select("id")
    .ilike("email", escapeIlike(normalized))
    .limit(1)
    .maybeSingle()
  if (error) return true // error de consulta ≠ "no es staff": falla-cerrado
  return !!(data as { id: string } | null)?.id
}
