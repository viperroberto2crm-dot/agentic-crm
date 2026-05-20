import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { Badge } from "@/components/ui/badge"
import { getTranslations } from "next-intl/server"

type TypedClient = SupabaseClient<Database>

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function fmtDate(iso: string) {
  const d = new Date(iso + "T12:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0]
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00")
  d.setDate(d.getDate() + days)
  return d.toISOString().split("T")[0]
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T12:00:00").getTime()
  const b = new Date(toIso + "T12:00:00").getTime()
  return Math.round((b - a) / 86_400_000)
}

type RawPlan = {
  id: string
  product_name: string
  total_amount_cents: number
  installment_count: number
  installment_amount_cents: number | null
  frequency_days: number
  first_due_date: string
  lead: {
    id: string
    first_name: string
    last_name: string | null
    brand_id: string
    assigned_rep_id: string | null
  } | null
  abonos: { id: string; amount_cents: number; paid_at: string }[]
}

export default async function PaymentsDuePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const t = await getTranslations("paymentsDue")
  const tc = await getTranslations("common")

  const [profileRes, cookieStore, params] = await Promise.all([
    sb.from("users").select("role").eq("id", user.id).single(),
    cookies(),
    searchParams,
  ])

  const role = (profileRes.data?.role ?? "rep") as string
  if (role === "provider") redirect("/appointments")
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  const sp = params as Record<string, string | string[] | undefined>
  const filter = typeof sp.filter === "string" ? sp.filter : null

  // Fetch all plans with schedule (installment_count NOT NULL).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = (sb as any)
    .from("payment_plans")
    .select(
      `id, product_name, total_amount_cents, installment_count, installment_amount_cents,
       frequency_days, first_due_date,
       lead:leads!payment_plans_lead_id_fkey(id, first_name, last_name, brand_id, assigned_rep_id),
       abonos(id, amount_cents, paid_at)`
    )
    .not("installment_count", "is", null)
    .not("first_due_date", "is", null)
    .not("frequency_days", "is", null)

  if (brandId) query = query.eq("brand_id", brandId)

  const { data: rawPlans, error } = (await query) as {
    data: RawPlan[] | null
    error: { message: string } | null
  }

  if (error) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <p className="text-sm text-red-500">{error.message}</p>
      </div>
    )
  }

  const today = todayIso()
  const inSevenDays = addDaysIso(today, 7)
  const inThirtyDays = addDaysIso(today, 30)

  type Row = {
    planId: string
    leadId: string
    leadName: string
    productName: string
    nextAmountCents: number
    nextDueDate: string
    daysRemaining: number
    paidCount: number
    totalCount: number
  }

  const rows: Row[] = []

  for (const plan of rawPlans ?? []) {
    if (!plan.lead) continue
    // Scope: reps only see plans for their own leads.
    if (role === "rep" && plan.lead.assigned_rep_id !== user.id) continue

    const paidCount = plan.abonos.length
    const totalCount = plan.installment_count
    if (paidCount >= totalCount) continue // fully paid -> not pending

    const expectedCents =
      plan.installment_amount_cents ??
      Math.round(plan.total_amount_cents / totalCount)

    // Next pending installment is index = paidCount (0-based)
    const nextDueDate = addDaysIso(plan.first_due_date, paidCount * plan.frequency_days)
    const daysRemaining = daysBetween(today, nextDueDate)

    rows.push({
      planId: plan.id,
      leadId: plan.lead.id,
      leadName: `${plan.lead.first_name} ${plan.lead.last_name ?? ""}`.trim(),
      productName: plan.product_name,
      nextAmountCents: expectedCents,
      nextDueDate,
      daysRemaining,
      paidCount,
      totalCount,
    })
  }

  // Apply filter
  let filteredRows = rows
  if (filter === "overdue") {
    filteredRows = rows.filter((r) => r.daysRemaining < 0)
  } else if (filter === "thisWeek") {
    filteredRows = rows.filter((r) => r.nextDueDate >= today && r.nextDueDate <= inSevenDays)
  } else if (filter === "next30") {
    filteredRows = rows.filter((r) => r.nextDueDate >= today && r.nextDueDate <= inThirtyDays)
  }

  // Sort: most overdue / soonest first
  filteredRows.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))

  const overdueCount = rows.filter((r) => r.daysRemaining < 0).length
  const thisWeekCount = rows.filter(
    (r) => r.nextDueDate >= today && r.nextDueDate <= inSevenDays
  ).length
  const next30Count = rows.filter(
    (r) => r.nextDueDate >= today && r.nextDueDate <= inThirtyDays
  ).length

  const tabs = [
    { value: null, label: tc("all"), count: rows.length },
    { value: "overdue", label: t("filterOverdue"), count: overdueCount },
    { value: "thisWeek", label: t("filterThisWeek"), count: thisWeekCount },
    { value: "next30", label: t("filterNext30"), count: next30Count },
  ] as const

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">{t("title")}</h1>
        <p className="text-xs text-gray-400">
          {filteredRows.length} {tc("records")}
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabs.map((tab) => {
          const isActive = filter === tab.value
          const href = tab.value ? `/payments-due?filter=${tab.value}` : "/payments-due"
          return (
            <Link
              key={tab.label}
              href={href}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                isActive
                  ? "bg-gray-200 text-gray-900"
                  : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 tabular-nums text-[10px] opacity-70">
                {tab.count}
              </span>
            </Link>
          )
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
        {filteredRows.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">{t("empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
                  Lead
                </th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">
                  {t("product")}
                </th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
                  {t("nextPaymentAmount")}
                </th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
                  {t("dueOn")}
                </th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
                  {t("daysRemaining")}
                </th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 hidden lg:table-cell">
                  {t("progress")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const isOverdue = row.daysRemaining < 0
                const isSoon = row.daysRemaining >= 0 && row.daysRemaining <= 3
                return (
                  <tr
                    key={row.planId}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <td className="py-3 pr-4">
                      <Link
                        href={`/leads/${row.leadId}`}
                        className="text-gray-800 hover:text-gray-900 font-medium"
                      >
                        {row.leadName}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 hidden md:table-cell">
                      <span className="text-xs text-gray-500">{row.productName}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-gray-900 font-medium tabular-nums">
                        {fmtCents(row.nextAmountCents)}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-xs text-gray-500 font-mono">
                        {fmtDate(row.nextDueDate)}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {isOverdue ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 font-normal border-red-500/40 text-red-500"
                        >
                          {Math.abs(row.daysRemaining)} {t("daysOverdue")}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 font-normal ${
                            isSoon
                              ? "border-amber-500/40 text-amber-600"
                              : "border-zinc-600 text-gray-500"
                          }`}
                        >
                          {row.daysRemaining} {t("daysRemainingShort")}
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 hidden lg:table-cell">
                      <span className="text-xs text-gray-400 tabular-nums">
                        {row.paidCount} / {row.totalCount}
                      </span>
                    </td>
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
