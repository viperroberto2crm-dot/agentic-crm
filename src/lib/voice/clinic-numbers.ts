import { normalizeToE164 } from "@/lib/integrations/800com"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Números de la clínica y de los bots. NUNCA son el teléfono de un paciente.
 *
 * El 714-467-2002 (el de todo el material de La Esperanza) reenvía al número de
 * Lucía, y al reenviar cambia el número de quien llama por el suyo: Retell recibe
 * from_number = +17144672002 para TODOS los pacientes. Si eso se guardara como
 * teléfono, cada paciente que dice "sí, este es mi número" caería en la misma
 * ficha (buscamos el lead por phone/phone_alt). Pasó el 2026-10-14.
 *
 * Se pueden agregar más con la variable VOICE_CLINIC_NUMBERS (separados por coma).
 */
const DEFAULT_CLINIC_NUMBERS = [
  "+18888800231", // número general viejo de La Esperanza
  "+17144672002", // La Esperanza (door hanger, VSL) → reenvía a Lucía
  "+17148554767", // Lucía
  "+17147101622", // Sofía
  "+17146134264", // Valeria
  "+17143644244", // María
  "+17144084207", // Camila
  "+15622983012", // asesor / pagos (destino de las transferencias)
]

function clinicNumbers(): Set<string> {
  const extra = (process.env.VOICE_CLINIC_NUMBERS ?? "")
    .split(",")
    .map((n) => normalizeToE164(n.trim()))
    .filter((n): n is string => !!n)
  return new Set([...DEFAULT_CLINIC_NUMBERS, ...extra])
}

/** true si el número (en cualquier formato) es de la clínica o de un bot. */
export function isClinicNumber(raw?: string | null): boolean {
  if (!raw) return false
  const e164 = normalizeToE164(raw)
  return !!e164 && clinicNumbers().has(e164)
}

/** El número de la llamada, o null si es de la clínica (llamada reenviada). */
export function patientCallerId(raw?: string | null): string | null {
  if (!raw || isClinicNumber(raw)) return null
  return raw
}

/** De dónde viene una llamada que llega reenviada con el número de la clínica. */
const KNOWN_SOURCES: Record<string, string> = {
  "+17144672002": "La Esperanza – publicidad (door hanger, volantes, banners)",
}

/**
 * Igual que patientCallerId, pero también descarta los números de rastreo
 * (tabla tracking_numbers, los de 800.com: Buses, Radio, Billboard…). Esos
 * reenvían a las líneas de los bots con SU número, así que tampoco son del
 * paciente. Devuelve además `cameFrom`: por dónde llamó (label – campaña), para
 * que el bot sepa qué promoción vio.
 *
 * Si la consulta a la tabla falla, se queda con la lista fija (no rompe la llamada).
 */
export async function resolveCaller(raw?: string | null): Promise<{ phone: string | null; cameFrom: string | null }> {
  if (!raw) return { phone: null, cameFrom: null }
  const e164 = normalizeToE164(raw)
  if (!e164) return { phone: raw, cameFrom: null }
  if (clinicNumbers().has(e164)) return { phone: null, cameFrom: KNOWN_SOURCES[e164] ?? null }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (createAdminClient() as any)
      .from("tracking_numbers")
      .select("label, campaign")
      .eq("phone_e164", e164)
      .limit(1)
      .maybeSingle()
    const row = data as { label: string | null; campaign: string | null } | null
    if (row) {
      const cameFrom = [row.label, row.campaign].filter(Boolean).join(" – ") || "un número de rastreo"
      return { phone: null, cameFrom }
    }
  } catch {
    /* sin tabla o sin conexión: seguimos con la lista fija */
  }
  return { phone: raw, cameFrom: null }
}
