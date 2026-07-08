"use server"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createAdminClient } from "@/lib/supabase/admin"
import { getEligibleIntakeBrand } from "@/lib/intake/eligible-brands"
import { parseIntakeFormData } from "@/lib/intake/form-data"
import { submitIntake } from "@/lib/intake/submit"

type SB = SupabaseClient<Database>

export type IntakeActionResult = { ok: boolean; error?: string }

/**
 * Server action PÚBLICO para la tablet en clínica (sin sesión).
 *
 * - Usa el admin-client (service role) porque la tablet no tiene sesión.
 * - Valida que el slug de marca sea una marca ELEGIBLE para intake
 *   (active AND slug NOT IN horizon/horizon-wound-care).
 * - Requiere first_name + phone.
 * - Honeypot: si el campo oculto `company` viene lleno, es un bot → devolvemos
 *   ok:true sin escribir nada.
 */
export async function submitPublicIntake(formData: FormData): Promise<IntakeActionResult> {
  try {
    // Honeypot anti-bot: un humano nunca llena este campo (está oculto).
    const honeypot = formData.get("company")
    if (typeof honeypot === "string" && honeypot.trim().length > 0) {
      return { ok: true }
    }

    const brandSlug = typeof formData.get("brand") === "string" ? String(formData.get("brand")).trim() : ""
    if (!brandSlug) return { ok: false, error: "missing brand" }

    const sb = createAdminClient() as unknown as SB
    const brand = await getEligibleIntakeBrand(sb, brandSlug)
    if (!brand) return { ok: false, error: "brand not eligible" }

    const values = parseIntakeFormData(formData)
    if (!values.first_name.trim() || !values.phone.trim()) {
      return { ok: false, error: "missing name/phone" }
    }

    await submitIntake({ sb, brandId: brand.id, brandSlug: brand.slug, values })
    return { ok: true }
  } catch (e) {
    console.error("[intake/public] error:", e instanceof Error ? e.message : String(e))
    return { ok: false, error: "server error" }
  }
}
