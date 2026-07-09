import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { Badge } from "@/components/ui/badge"
import { CancelSubscriptionButton } from "./_components/cancel-button"
import { getTranslations } from "next-intl/server"
import { parseDbDate } from "@/lib/datetime"

type TypedClient = SupabaseClient<Database>

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function fmtDate(d: string) {
  const parsed = parseDbDate(d)
  if (!parsed) return "—"
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed)
}

function daysUntil(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const t = await getTranslations("sales")

  const CADENCE_LABEL: Record<string, string> = {
    weekly:    t("subs.cadenceWeekly"),
    biweekly:  t("subs.cadenceBiweekly"),
    monthly:   t("subs.cadenceMonthly"),
    quarterly: t("subs.cadenceQuarterly"),
    annual:    t("subs.cadenceAnnual"),
  }

  const [profileRes, cookieStore, params] = await Promise.all([
    sb.from("users").select("role").eq("id", user.id).single(),
    cookies(),
    searchParams,
  ])

  const role = (profileRes.data?.role ?? "rep") as string
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  const sp = params as Record<string, string | string[] | undefined>
  const statusFilter = typeof sp.status === "string" ? sp.status : "active"

  let query = sb
    .from("subscriptions")
    .select(
      `id, cadence, billing_cycle_days, amount_cents, status, next_billing_at, started_at, cancelled_at,
       lead:leads!subscriptions_lead_id_fkey(id, first_name, last_name),
       product:products!subscriptions_product_id_fkey(id, name)`,
      { count: "exact" }
    )
    .order("next_billing_at", { ascending: true })
    .limit(100)

  if (brandId) query = query.eq("brand_id", brandId)
  if (statusFilter && statusFilter !== "all") query = query.eq("status", statusFilter)

  const { data: raw, count } = await query

  type SubItem = {
    id: string; cadence: string; billing_cycle_days: number; amount_cents: number
    status: string; next_billing_at: string; started_at: string; cancelled_at: string | null
    lead: { id: string; first_name: string; last_name: string | null } | null
    product: { id: string; name: string } | null
  }
  const subs = (raw ?? []) as unknown as SubItem[]

  const totalActive = subs.filter((s) => s.status === "active").length
  const totalMonthlyCents = subs
    .filter((s) => s.status === "active")
    .reduce((sum, s) => {
      const monthly = s.billing_cycle_days > 0
        ? Math.round((s.amount_cents / s.billing_cycle_days) * 30)
        : s.amount_cents
      return sum + monthly
    }, 0)

  const statusTabs = [
    { value: "active",    label: t("subs.activeTab") },
    { value: "cancelled", label: t("subs.cancelledTab") },
    { value: "all",       label: t("subs.allTab") },
  ] as const

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t("subs.title")}</h1>
          <Link href="/sales" className="text-xs text-gray-400 hover:text-gray-500 transition-colors">
            {t("subs.backToSales")}
          </Link>
        </div>
        <span className="text-xs text-gray-400">{count ?? subs.length} total</span>
      </div>

      {statusFilter === "active" && (
        <div className="flex gap-6">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">{t("subs.kpiActive")}</p>
            <p className="text-2xl font-semibold tabular-nums" style={{ color: "var(--brand)" }}>{totalActive}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">{t("subs.kpiMrr")}</p>
            <p className="text-2xl font-semibold tabular-nums text-gray-800">{fmtCents(totalMonthlyCents)}</p>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {statusTabs.map((tab) => {
          const isActive = statusFilter === tab.value
          return (
            <Link
              key={tab.value}
              href={`/sales/subscriptions?status=${tab.value}`}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                isActive ? "bg-gray-200 text-gray-900" : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
        {subs.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">{t("subs.noSubsFilter")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">Lead</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden sm:table-cell">{t("subs.colProduct")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">{t("subs.colCadence")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("subs.colAmount")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("subs.colNextBilling")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("subs.colStatus")}</th>
                {(role === "admin" || role === "manager") && statusFilter === "active" && (
                  <th className="pb-2" />
                )}
              </tr>
            </thead>
            <tbody>
              {subs.map((sub) => {
                const days = sub.status === "active" ? daysUntil(sub.next_billing_at) : null
                const isSoon = days !== null && days <= 7 && days >= 0
                const isOverdue = days !== null && days < 0

                return (
                  <tr key={sub.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 pr-4">
                      {sub.lead ? (
                        <Link href={`/leads/${sub.lead.id}`} className="text-gray-800 hover:text-gray-900 font-medium transition-colors">
                          {sub.lead.first_name} {sub.lead.last_name ?? ""}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 hidden sm:table-cell">
                      <span className="text-xs text-gray-500">{sub.product?.name ?? "—"}</span>
                    </td>
                    <td className="py-3 pr-4 hidden md:table-cell">
                      <span className="text-xs text-gray-400">{CADENCE_LABEL[sub.cadence] ?? sub.cadence}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-gray-800 font-medium tabular-nums text-sm">{fmtCents(sub.amount_cents)}</span>
                    </td>
                    <td className="py-3 pr-4">
                      {sub.status === "active" ? (
                        <span className={`text-xs tabular-nums ${isOverdue ? "text-red-400" : isSoon ? "text-amber-400 font-medium" : "text-gray-400"}`}>
                          {isOverdue ? t("subs.overdue") : isSoon ? `${days}d — ${fmtDate(sub.next_billing_at)}` : fmtDate(sub.next_billing_at)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">{sub.cancelled_at ? fmtDate(sub.cancelled_at) : "—"}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 font-normal ${
                          sub.status === "active"
                            ? "border-emerald-500/40 text-emerald-400"
                            : "border-gray-300 text-gray-400"
                        }`}
                      >
                        {sub.status === "active" ? t("subs.active") : t("subs.cancelled")}
                      </Badge>
                    </td>
                    {(role === "admin" || role === "manager") && statusFilter === "active" && (
                      <td className="py-3 text-right">
                        {sub.status === "active" && (
                          <CancelSubscriptionButton id={sub.id} leadName={`${sub.lead?.first_name ?? ""} ${sub.lead?.last_name ?? ""}`.trim()} />
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  )
}
