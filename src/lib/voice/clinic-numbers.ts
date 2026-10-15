import { normalizeToE164 } from "@/lib/integrations/800com"

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
