import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Números por marca para SMS (Twilio), leídos de `tracking_numbers` (la misma
 * tabla que se usa para medir publicidad con 800.com; ya soporta provider
 * 'twilio'). Así, cada marca envía desde SU número y los entrantes se atribuyen
 * a la marca dueña del número que los recibió. Sin tabla ni UI nueva: los
 * números se administran en Configuración → Números de rastreo (provider Twilio).
 *
 * Ambas funciones usan el admin client (service-role) porque corren en acciones
 * de servidor / webhook; la autorización por marca ya la aplica el llamador
 * (sendSms valida membresía de marca ANTES de resolver el número).
 */

/**
 * Resuelve el número Twilio de ENVÍO para una marca. Prefiere continuidad: si el
 * paciente ya tuvo hilo con uno de nuestros números de esa marca, responde desde
 * ese mismo (para no confundir al paciente con números distintos). Si la marca no
 * tiene número Twilio configurado, regresa null → el llamador usa el from_number
 * global como respaldo.
 */
export async function resolveBrandTwilioFrom(
  brandId: string,
  leadId: string,
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  const { data: tnRows } = await sb
    .from("tracking_numbers")
    .select("phone_e164, created_at")
    .eq("brand_id", brandId)
    .eq("provider", "twilio")
    .eq("active", true)
    .order("created_at", { ascending: true })
  const nums = ((tnRows ?? []) as { phone_e164: string | null }[])
    .map((r) => r.phone_e164)
    .filter((p): p is string => !!p && p.startsWith("+"))
  if (nums.length === 0) return null

  // Continuidad: el último número NUESTRO usado con este paciente (entrante →
  // to_number; saliente → from_number). Solo se reutiliza si sigue siendo un
  // número activo de esta marca.
  const { data: lastRows } = await sb
    .from("messages")
    .select("direction, from_number, to_number")
    .eq("lead_id", leadId)
    .eq("provider", "twilio")
    .order("created_at", { ascending: false })
    .limit(1)
  const last = ((lastRows ?? []) as {
    direction: string
    from_number: string | null
    to_number: string | null
  }[])[0]
  if (last) {
    const ours = last.direction === "in" ? last.to_number : last.from_number
    if (ours && nums.includes(ours)) return ours
  }
  return nums[0]
}

/**
 * Resuelve la marca dueña de uno de NUESTROS números Twilio (por el número que
 * recibió el mensaje entrante). Sirve para atribuir a marca/canal los textos de
 * pacientes que aún no son leads. null si el número no está registrado.
 */
export async function resolveBrandByTwilioNumber(
  e164: string,
): Promise<string | null> {
  if (!e164) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  const { data } = await sb
    .from("tracking_numbers")
    .select("brand_id")
    .eq("phone_e164", e164)
    .eq("provider", "twilio")
    .eq("active", true)
    .limit(2)
  const rows = (data ?? []) as { brand_id: string | null }[]
  // Ambigüedad (mismo número activo en 2 marcas por mala config) → NO atribuir,
  // igual que matchLead. Fail-closed: el mensaje queda service-role-only, nunca
  // en la marca equivocada (Fable #1).
  if (rows.length !== 1) return null
  return rows[0].brand_id ?? null
}
