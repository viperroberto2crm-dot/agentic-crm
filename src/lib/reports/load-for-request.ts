import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/types/database"
import { BRAND_TIMEZONE } from "@/lib/datetime"
import { NO_BRAND_SENTINEL, resolveEffectiveBrandId } from "@/lib/queries/brand-access"
import { dateOnlyRangeToUtc, getPresetRange, isValidYmd } from "@/lib/dashboard/date-ranges"
import { loadCallReport, type CallReport } from "./call-report-data"

type SearchParams = { [key: string]: string | string[] | undefined }

export type ReportRequest = {
  report: CallReport
  from: string
  to: string
  selected: string[]
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * Valida sesión, rol y marca, y arma el informe. Lo comparten la página
 * /informes y la versión imprimible. Contiene teléfonos y estados de personas
 * (PII): solo admin y manager; la marca se resuelve contra user_brands.
 */
export async function loadReportForRequest(sp: SearchParams): Promise<ReportRequest> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as SupabaseClient<Database>
  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).single()
  const role = (profile?.role ?? "rep") as string
  if (role !== "admin" && role !== "manager") redirect("/dashboard")

  const cookieStore = await cookies()
  const slug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = await resolveEffectiveBrandId(sb, user.id, role, slug)
  if (brandId === NO_BRAND_SENTINEL) redirect("/dashboard")

  // Por defecto: mes anterior completo + lo que va del mes actual (hora de California).
  const defFrom = getPresetRange("lastMonth", BRAND_TIMEZONE).from
  const defTo = getPresetRange("thisMonth", BRAND_TIMEZONE).to
  const qFrom = one(sp.from)
  const qTo = one(sp.to)
  let from = qFrom && isValidYmd(qFrom) ? qFrom : defFrom
  let to = qTo && isValidYmd(qTo) ? qTo : defTo
  if (from > to) [from, to] = [to, from]

  const raw = sp.n
  const selected = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((n) => /^\+\d{8,15}$/.test(n))

  const range = dateOnlyRangeToUtc(from, to, BRAND_TIMEZONE)
  const report = await loadCallReport(sb, {
    brandId: brandId === NO_BRAND_SENTINEL ? null : brandId,
    startIso: range.start,
    endIso: range.end,
    numbers: selected,
  })
  return { report, from, to, selected }
}
