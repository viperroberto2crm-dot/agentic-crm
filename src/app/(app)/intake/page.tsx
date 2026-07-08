import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getTranslations } from "next-intl/server"
import { listEligibleIntakeBrands } from "@/lib/intake/eligible-brands"
import { IntakeForm } from "../../intake/[brand]/_components/intake-form"
import { submitStaffIntake } from "./actions"

type SB = SupabaseClient<Database>

export default async function StaffIntakePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as SB
  const t = await getTranslations("intake")

  const { data: profileRes } = await sb.from("users").select("role").eq("id", user.id).single()
  const role = (profileRes?.role ?? "rep") as string
  if (role === "provider") redirect("/leads")

  // Marcas elegibles para intake.
  let eligible = await listEligibleIntakeBrands(sb)

  // No-admin: intersección con sus marcas autorizadas (user_brands).
  if (role !== "admin") {
    const { data: ub } = await sb.from("user_brands").select("brand_id").eq("user_id", user.id)
    const authorized = new Set((ub ?? []).map((r) => r.brand_id as string))
    eligible = eligible.filter((b) => authorized.has(b.id))
  }

  const brands = eligible.map((b) => ({ slug: b.slug, name: b.name }))

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("pageSubtitle")}</p>
      </div>

      {brands.length === 0 ? (
        <div className="bg-white border border-border/60 rounded-2xl p-6 text-sm text-muted-foreground">
          {t("noBrands")}
        </div>
      ) : (
        <div className="bg-white border border-border/60 rounded-2xl p-5 md:p-6">
          <IntakeForm action={submitStaffIntake} mode="internal" brands={brands} defaultLang="es" />
        </div>
      )}
    </div>
  )
}
