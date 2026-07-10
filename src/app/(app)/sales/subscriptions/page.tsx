import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
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

// Degradados para el avatar de paciente; se elige de forma estable por seed.
const AVATAR_GRADS = [
  "linear-gradient(150deg,#EF7B5C,#E2653F)",
  "linear-gradient(150deg,#3FA278,#2C6B57)",
  "linear-gradient(150deg,#5F8CE6,#3E63B8)",
  "linear-gradient(150deg,#E0A64E,#C88A2E)",
  "linear-gradient(150deg,#8E7CC3,#6E5AA6)",
  "linear-gradient(150deg,#D5807E,#B85D5B)",
]

function avatarGrad(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_GRADS[h % AVATAR_GRADS.length]
}

function initials(name: string): string {
  const p = (name || "?").trim().split(/\s+/)
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "") || "?").toUpperCase()
}

function PatientAvatar({ name, seed }: { name: string; seed: string }) {
  return (
    <span
      aria-hidden
      className="w-10 h-10 rounded-[13px] shrink-0 grid place-items-center text-white font-semibold text-[14px] shadow-[0_2px_6px_rgba(18,60,48,0.14)] select-none"
      style={{ background: avatarGrad(seed) }}
    >
      {initials(name)}
    </span>
  )
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

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[#20342C]">{t("subs.title")}</h1>
          <Link href="/sales" className="text-[13px] text-[#93A39D] hover:text-[#5C6F68] transition-colors mt-1 inline-block">
            {t("subs.backToSales")}
          </Link>
        </div>
        <span className="text-[13px] text-[#93A39D] tabular-nums">{count ?? subs.length} total</span>
      </div>

      {statusFilter === "active" && (
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-3">
          <div className="bg-card border border-[#ECE3D3] rounded-2xl p-4 min-w-[160px] shadow-[0_1px_2px_rgba(26,46,40,0.05),0_10px_28px_-14px_rgba(26,46,40,0.12)]">
            <p className="text-[10px] text-[#93A39D] uppercase tracking-widest font-semibold mb-2">{t("subs.kpiActive")}</p>
            <p className="font-display text-2xl font-semibold tabular-nums leading-none" style={{ color: "var(--brand)" }}>{totalActive}</p>
          </div>
          <div className="bg-card border border-[#ECE3D3] rounded-2xl p-4 min-w-[160px] shadow-[0_1px_2px_rgba(26,46,40,0.05),0_10px_28px_-14px_rgba(26,46,40,0.12)]">
            <p className="text-[10px] text-[#93A39D] uppercase tracking-widest font-semibold mb-2">{t("subs.kpiMrr")}</p>
            <p className="font-display text-2xl font-semibold tabular-nums leading-none text-[#20342C]">{fmtCents(totalMonthlyCents)}</p>
          </div>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {statusTabs.map((tab) => {
          const isActive = statusFilter === tab.value
          return (
            <Link
              key={tab.value}
              href={`/sales/subscriptions?status=${tab.value}`}
              className={`h-8 px-3.5 inline-flex items-center rounded-full text-[13px] font-medium border transition-colors ${
                isActive
                  ? "bg-[#20342C] text-white border-[#20342C]"
                  : "bg-card text-[#5C6F68] border-[#ECE3D3] hover:border-[#D8CDB5]"
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      <div className="bg-card border border-[#ECE3D3] rounded-2xl px-4 py-1 shadow-[0_1px_2px_rgba(26,46,40,0.05),0_10px_28px_-14px_rgba(26,46,40,0.12)]">
        {subs.length === 0 ? (
          <p className="text-sm text-[#93A39D] py-8 text-center">{t("subs.noSubsFilter")}</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#ECE3D3]">
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4 min-w-[180px]">Lead</th>
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4 hidden sm:table-cell">{t("subs.colProduct")}</th>
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">{t("subs.colCadence")}</th>
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4">{t("subs.colAmount")}</th>
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4">{t("subs.colNextBilling")}</th>
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4">{t("subs.colStatus")}</th>
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
                const leadName = sub.lead ? `${sub.lead.first_name} ${sub.lead.last_name ?? ""}`.trim() : ""

                return (
                  <tr key={sub.id} className="border-b border-[#F1EADD] hover:bg-[#FBF6EC] transition-colors">
                    <td className="py-3 pr-4">
                      {sub.lead ? (
                        <div className="flex items-center gap-3 min-w-0">
                          <PatientAvatar name={leadName} seed={sub.lead.id} />
                          <Link href={`/leads/${sub.lead.id}`} className="font-semibold text-[15px] text-[#20342C] hover:text-[#12483B] transition-colors truncate">
                            {sub.lead.first_name} {sub.lead.last_name ?? ""}
                          </Link>
                        </div>
                      ) : (
                        <span className="text-[#C9C0AF]">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 hidden sm:table-cell">
                      <span className="text-[13px] text-[#5C6F68]">{sub.product?.name ?? "—"}</span>
                    </td>
                    <td className="py-3 pr-4 hidden md:table-cell">
                      <span className="text-[13px] text-[#93A39D]">{CADENCE_LABEL[sub.cadence] ?? sub.cadence}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-[#20342C] font-semibold tabular-nums text-sm">{fmtCents(sub.amount_cents)}</span>
                    </td>
                    <td className="py-3 pr-4">
                      {sub.status === "active" ? (
                        <span className={`text-[13px] tabular-nums ${isOverdue ? "text-[#B85D5B]" : isSoon ? "text-[#B67C22] font-medium" : "text-[#93A39D]"}`}>
                          {isOverdue ? t("subs.overdue") : isSoon ? `${days}d — ${fmtDate(sub.next_billing_at)}` : fmtDate(sub.next_billing_at)}
                        </span>
                      ) : (
                        <span className="text-[13px] text-[#C9C0AF]">{sub.cancelled_at ? fmtDate(sub.cancelled_at) : "—"}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {sub.status === "active" ? (
                        <span
                          className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap"
                          style={{ backgroundColor: "#E6F3EC", color: "#2E7E5B" }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#3FA278" }} />
                          {t("subs.active")}
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap"
                          style={{ backgroundColor: "#F0EBE0", color: "#7C7259" }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#C7B48A" }} />
                          {t("subs.cancelled")}
                        </span>
                      )}
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
          </div>
        )}
      </div>

    </div>
  )
}
