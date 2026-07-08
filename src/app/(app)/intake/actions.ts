"use server"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createClient } from "@/lib/supabase/server"
import { getEligibleIntakeBrand } from "@/lib/intake/eligible-brands"
import { parseIntakeFormData } from "@/lib/intake/form-data"
import { submitIntake } from "@/lib/intake/submit"

type SB = SupabaseClient<Database>

export type IntakeActionResult = { ok: boolean; error?: string }

/**
 * Server action AUTENTICADO (staff) para registrar una admisión desde el CRM.
 *
 * Re-verifica rol + membresía de marca en el servidor (nunca confía en el
 * cliente) y usa el cliente de SESIÓN (RLS). La marca debe ser elegible para
 * intake; los no-admin solo pueden usar marcas de su user_brands.
 */
export async function submitStaffIntake(formData: FormData): Promise<IntakeActionResult> {
  try {
    const supabase = (await createClient()) as unknown as SB
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "unauthenticated" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    const role = (profile?.role ?? "rep") as string
    // Providers tienen vista restringida; no crean admisiones.
    if (role === "provider") return { ok: false, error: "forbidden" }

    const brandSlug = typeof formData.get("brand") === "string" ? String(formData.get("brand")).trim() : ""
    if (!brandSlug) return { ok: false, error: "missing brand" }

    const brand = await getEligibleIntakeBrand(supabase, brandSlug)
    if (!brand) return { ok: false, error: "brand not eligible" }

    // No-admin: debe ser miembro de la marca (user_brands).
    if (role !== "admin") {
      const { data: membership } = await supabase
        .from("user_brands")
        .select("user_id")
        .eq("user_id", user.id)
        .eq("brand_id", brand.id)
        .maybeSingle()
      if (!membership) return { ok: false, error: "forbidden brand" }
    }

    const values = parseIntakeFormData(formData)
    if (!values.first_name.trim() || !values.phone.trim()) {
      return { ok: false, error: "missing name/phone" }
    }

    await submitIntake({ sb: supabase, brandId: brand.id, brandSlug: brand.slug, values })
    return { ok: true }
  } catch (e) {
    console.error("[intake/staff] error:", e instanceof Error ? e.message : String(e))
    return { ok: false, error: "server error" }
  }
}
