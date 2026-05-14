import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getTranslations } from "next-intl/server"
import { ExportButton } from "@/components/exports/export-button"

export const dynamic = "force-dynamic"

type TypedClient = SupabaseClient<Database>

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function fmtDate(d: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d))
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const t = await getTranslations("sales")
  const tc = await getTranslations("common")

  const STATUS_CONFIG = {
    paid:     { label: t("paid"),     className: "border-emerald-500/40 text-emerald-400" },
    pending:  { label: t("pending"),  className: "border-amber-500/40 text-amber-400" },
    failed:   { label: t("failed"),   className: "border-red-500/40 text-red-500" },
    refunded: { label: t("refunded"), className: "border-zinc-600 text-gray-400" },
    partial:  { label: t("partial"),  className: "border-blue-500/40 text-blue-400" },
  } as const

  const [profileRes, cookieStore, params] = await Promise.all([
    sb.from("users").select("role").eq("id", user.id).single(),
    cookies(),
    searchParams,
  ])

  const role = (profileRes.data?.role ?? "rep") as string
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  const sp = params as Record<string, string | string[] | undefined>
  const statusFilter = typeof sp.status === "string" ? sp.status : null

  let query = sb
    .from("sales")
    .select(
      `id, amount_cents, payment_method, payment_status, paid_at, created_at, notes,
       lead:leads!sales_lead_id_fkey(id, first_name, last_name),
       rep:users!sales_rep_id_fkey(id, name)`,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .limit(100)

  if (role === "rep") {
    query = query.eq("rep_id", user.id)
  }

  if (brandId) {
    query = query.eq("brand_id", brandId)
  }

  if (statusFilter) {
    query = query.eq("payment_status", statusFilter as Database["public"]["Enums"]["payment_status"])
  }

  const { data: salesRaw, count } = await query

  type SaleItem = {
    id: string
    amount_cents: number
    payment_method: string
    payment_status: Database["public"]["Enums"]["payment_status"]
    paid_at: string | null
    created_at: string
    notes: string | null
    lead: { id: string; first_name: string; last_name: string | null } | null
    rep: { id: string; name: string } | null
  }

  const sales = (salesRaw ?? []) as unknown as SaleItem[]

  const totalPaidCents = sales
    .filter((s) => s.payment_status === "paid")
    .reduce((sum, s) => sum + s.amount_cents, 0)

  const totalPendingCents = sales
    .filter((s) => s.payment_status === "pending")
    .reduce((sum, s) => sum + s.amount_cents, 0)

  const paidCount = sales.filter((s) => s.payment_status === "paid").length
  const pendingCount = sales.filter((s) => s.payment_status === "pending").length

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">{t("title")}</h1>
        <div className="flex items-center gap-3">
          <p className="text-xs text-gray-400">{count ?? sales.length} {tc("records")}</p>
          <ExportButton entity="sales" extraParams={{ status: statusFilter }} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={t("kpiCharged")}
          value={fmtCents(totalPaidCents)}
          sub={`${paidCount} ${paidCount !== 1 ? t("salePlural") : t("saleSingular")}`}
          accent="var(--brand)"
        />
        <KpiCard
          label={t("kpiToCollect")}
          value={fmtCents(totalPendingCents)}
          sub={`${pendingCount} ${pendingCount !== 1 ? t("pendingPlural") : t("pendingSingular")}`}
          accent="#F59E0B"
        />
        <KpiCard
          label={t("kpiTotal")}
          value={fmtCents(totalPaidCents + totalPendingCents)}
          sub={`${sales.length} ${tc("total")}`}
          accent="#6B7280"
        />
        <KpiCard
          label={t("kpiAvgTicket")}
          value={paidCount > 0 ? fmtCents(Math.round(totalPaidCents / paidCount)) : "$0"}
          sub={t("kpiCollected")}
          accent="#6B7280"
        />
      </div>

      <div className="flex gap-2 flex-wrap">
        {([
          { value: null,      label: t("allSales") },
          { value: "paid",    label: t("paidSales") },
          { value: "pending", label: t("pendingSales") },
          { value: "failed",  label: t("failedSales") },
        ] as const).map((tab) => {
          const isActive = statusFilter === tab.value
          return (
            <Link
              key={tab.label}
              href={tab.value ? `/sales?status=${tab.value}` : "/sales"}
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
        {sales.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            {t("noSalesFilter")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("colLead")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("colAmount")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("colStatus")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">{t("colMethod")}</th>
                {role !== "rep" && (
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden lg:table-cell">Rep</th>
                )}
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 hidden sm:table-cell">{t("colDate")}</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => {
                const cfg = STATUS_CONFIG[sale.payment_status] ?? STATUS_CONFIG.pending
                return (
                  <tr key={sale.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 pr-4">
                      {sale.lead ? (
                        <Link href={`/leads/${sale.lead.id}`} className="text-gray-800 hover:text-gray-900 transition-colors font-medium">
                          {sale.lead.first_name} {sale.lead.last_name ?? ""}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-gray-900 font-medium tabular-nums">{fmtCents(sale.amount_cents)}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-normal ${cfg.className}`}>
                        {cfg.label}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 hidden md:table-cell">
                      <span className="text-xs text-gray-400 capitalize">{sale.payment_method}</span>
                    </td>
                    {role !== "rep" && (
                      <td className="py-3 pr-4 hidden lg:table-cell">
                        <span className="text-xs text-gray-400">{sale.rep?.name ?? "—"}</span>
                      </td>
                    )}
                    <td className="py-3 hidden sm:table-cell">
                      <span className="text-xs text-gray-400">{fmtDate(sale.paid_at ?? sale.created_at)}</span>
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

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="p-4">
        <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-2">{label}</p>
        <p className="text-xl font-semibold tabular-nums leading-none" style={{ color: accent }}>{value}</p>
        <p className="text-[11px] text-gray-400 mt-1.5">{sub}</p>
      </CardContent>
    </Card>
  )
}
