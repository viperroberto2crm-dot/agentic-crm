import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import QRCode from "qrcode"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getTranslations } from "next-intl/server"
import { listEligibleIntakeBrands } from "@/lib/intake/eligible-brands"
import { IntakeForm } from "../../intake/[brand]/_components/intake-form"
import { IntakeLinksPanel, type IntakeLinkItem } from "./_components/intake-links-panel"
import { submitStaffIntake } from "./actions"

type SB = SupabaseClient<Database>

const FALLBACK_COLORS: Record<string, string> = {
  "si-se-pierde": "#0acdc0",
  "sunny-slim": "#e2c11d",
  "la-esperanza": "#0206ed",
}

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

  // Colores reales de marca para el panel de links (fallback por slug si falta).
  const colorBySlug = new Map<string, string>()
  if (eligible.length > 0) {
    const { data: colorRows } = await sb
      .from("brands")
      .select("slug, brand_color")
      .in("slug", eligible.map((b) => b.slug))
    for (const r of colorRows ?? []) {
      if (r.brand_color) colorBySlug.set(r.slug as string, r.brand_color as string)
    }
  }

  // Base URL del request (para que los QR/links apunten al dominio actual).
  const h = await headers()
  const host = h.get("host") ?? ""
  const proto = h.get("x-forwarded-proto") ?? "https"
  let linkItems: IntakeLinkItem[] = []
  if (host) {
    // Landing selector (/admision): un QR que abre la pantalla para elegir clínica.
    const hubUrl = `${proto}://${host}/admision`
    const hub: IntakeLinkItem = {
      slug: "__selector__",
      name: t("selectorAll"),
      color: "#0E5F4C",
      url: hubUrl,
      qrDataUrl: await QRCode.toDataURL(hubUrl, { width: 176, margin: 1 }),
    }
    const perClinic = await Promise.all(
      eligible.map(async (b): Promise<IntakeLinkItem> => {
        const url = `${proto}://${host}/intake/${b.slug}`
        const qrDataUrl = await QRCode.toDataURL(url, { width: 176, margin: 1 })
        return {
          slug: b.slug,
          name: b.name,
          color: colorBySlug.get(b.slug) ?? FALLBACK_COLORS[b.slug] ?? "#0E5F4C",
          url,
          qrDataUrl,
        }
      }),
    )
    linkItems = [hub, ...perClinic]
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("pageSubtitle")}</p>
      </div>

      <IntakeLinksPanel
        items={linkItems}
        labels={{
          title: t("linksTitle"),
          subtitle: t("linksSubtitle"),
          copy: t("copyLink"),
          copied: t("copied"),
          open: t("openForm"),
        }}
      />

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
