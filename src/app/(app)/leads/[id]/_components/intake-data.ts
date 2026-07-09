// Tipo + extractor de datos de intake (demográficos) desde leads.custom_fields.
// IMPORTANTE: este archivo NO lleva "use client". extractIntakeData se invoca
// desde el SERVER component (page.tsx); si viviera en intake-card.tsx (que sí es
// "use client") Next.js lanza "Attempted to call ... from the server but ... is
// on the client". Por eso el tipo + la función puros viven aquí, separados del
// componente cliente IntakeCard.

export type IntakeData = {
  dob?: string | null
  gender?: string | null
  identifies_as?: string | null
  occupation?: string | null
  marital_status?: string | null
  preferred_language?: string | null
}

/** Extrae los campos de intake de un custom_fields (jsonb) desconocido. */
export function extractIntakeData(customFields: unknown): IntakeData | null {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) {
    return null
  }
  const cf = customFields as Record<string, unknown>
  const pick = (k: string): string | null => {
    const v = cf[k]
    return typeof v === "string" && v.trim().length > 0 ? v : null
  }
  const data: IntakeData = {
    dob: pick("dob"),
    gender: pick("gender"),
    identifies_as: pick("identifies_as"),
    occupation: pick("occupation"),
    marital_status: pick("marital_status"),
    preferred_language: pick("preferred_language"),
  }
  const hasAny = Object.values(data).some((v) => v)
  return hasAny ? data : null
}
