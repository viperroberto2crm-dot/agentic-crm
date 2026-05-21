import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { getSalesBreakdown } from "@/lib/queries/sales-kpi"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getTranslations } from "next-intl/server"
import { ExportButton } from "@/components/exports/export-button"
import { ReportExportButton } from "@/components/exports/report-export-button"
import { BRAND_TIMEZONE } from "@/lib/datetime"
import { RepCellSelectClient } from "./_components/rep-cell-select-client"
import { PatientSearchInput } from "@/components/ui/patient-search-input"

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
    timeZone: BRAND_TIMEZONE,
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
  if (role === "provider") redirect("/appointments")
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  const sp = params as Record<string, string | string[] | undefined>
  const statusFilter = typeof sp.status === "string" ? sp.status : null
  const groupBy = sp.view === "patient" ? "patient" : "sale"
  const searchTerm = typeof sp.search === "string" ? sp.search.trim() : null

  // Si hay búsqueda, primero saco los lead_ids que matchean
  let leadIdsFilter: string[] | null = null
  if (searchTerm && brandId) {
    const tokens = searchTerm.replace(/[(),]/g, " ").split(/\s+/).filter(Boolean)
    const orParts: string[] = []
    for (const tok of tokens) {
      const t = tok.replace(/%/g, "")
      orParts.push(`first_name.ilike.%${t}%`, `last_name.ilike.%${t}%`, `phone.ilike.%${t}%`)
    }
    const { data: matchingLeads } = await sb
      .from("leads")
      .select("id")
      .eq("brand_id", brandId)
      .or(orParts.join(","))
      .limit(500)
    leadIdsFilter = (matchingLeads ?? []).map((l) => l.id)
    if (leadIdsFilter.length === 0) leadIdsFilter = ["00000000-0000-0000-0000-000000000000"]
  }

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

  if (leadIdsFilter) {
    query = query.in("lead_id", leadIdsFilter)
  }

  const { data: salesRaw, count } = await query

  // Reps disponibles para reasignar (admin/manager only)
  const canReassign = role === "admin" || role === "manager"
  let brandReps: { id: string; name: string }[] = []
  if (canReassign && brandId) {
    const { data: repsData } = await sb
      .from("users")
      .select("id, name, user_brands!inner(brand_id)")
      .eq("active", true)
      .eq("user_brands.brand_id", brandId)
      .in("role", ["admin", "manager", "rep"])
      .order("name")
    brandReps = (repsData ?? []).map((u) => ({
      id: u.id as string,
      name: (u.name as string | null) ?? "—",
    }))
  }

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

  // Vista "Por paciente": agrupa ventas por lead.id y suma totales.
  type PatientGroup = {
    leadId: string
    leadName: string
    repName: string | null
    salesCount: number
    paidCents: number
    pendingCents: number
    lastDate: string
    hasPlan: boolean
  }
  const patientGroups: PatientGroup[] = (() => {
    if (groupBy !== "patient") return []
    const map = new Map<string, PatientGroup>()
    for (const s of sales) {
      if (!s.lead) continue
      const id = s.lead.id
      const name = `${s.lead.first_name} ${s.lead.last_name ?? ""}`.trim()
      const dateIso = s.paid_at ?? s.created_at
      const isPaid = s.payment_status === "paid"
      const isPartial = s.payment_status === "partial"
      const planMarker = (s.notes ?? "").toLowerCase().includes("payment plan")
      const existing = map.get(id)
      if (!existing) {
        map.set(id, {
          leadId: id,
          leadName: name,
          repName: s.rep?.name ?? null,
          salesCount: 1,
          paidCents: isPaid ? s.amount_cents : 0,
          pendingCents: isPartial || s.payment_status === "pending" ? s.amount_cents : 0,
          lastDate: dateIso,
          hasPlan: planMarker,
        })
      } else {
        existing.salesCount += 1
        if (isPaid) existing.paidCents += s.amount_cents
        if (isPartial || s.payment_status === "pending") existing.pendingCents += s.amount_cents
        if (dateIso > existing.lastDate) existing.lastDate = dateIso
        if (planMarker) existing.hasPlan = true
      }
    }
    return Array.from(map.values()).sort((a, b) => b.lastDate.localeCompare(a.lastDate))
  })()

  // KPIs agregados — usa el helper compartido para consistencia con Dashboard
  const breakdown = await getSalesBreakdown(sb, {
    brandId,
    repId: role === "rep" ? user.id : null,
  })
  const totalPaidCents = breakdown.collectedCents
  const totalPendingCents = breakdown.outstandingCents
  const paidCount = breakdown.paidCount
  const pendingCount = breakdown.openCount

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">{t("title")}</h1>
        <div className="flex items-center gap-3">
          <p className="text-xs text-gray-400">{count ?? sales.length} {tc("records")}</p>
          <ReportExportButton defaultBrand={brandSlug ?? ""} />
          <ExportButton entity="sales" extraParams={{ status: statusFilter }} />
        </div>
      </div>

      <PatientSearchInput placeholder="Buscar paciente por nombre o teléfono…" />

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

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {([
            { value: null,      label: t("allSales") },
            { value: "paid",    label: t("paidSales") },
            { value: "pending", label: t("pendingSales") },
            { value: "failed",  label: t("failedSales") },
          ] as const).map((tab) => {
            const isActive = statusFilter === tab.value
            const qs = new URLSearchParams()
            if (tab.value) qs.set("status", tab.value)
            if (groupBy === "patient") qs.set("view", "patient")
            const href = qs.toString() ? `/sales?${qs.toString()}` : "/sales"
            return (
              <Link
                key={tab.label}
                href={href}
                className={`px-3 py-1 rounded text-xs transition-colors ${
                  isActive ? "bg-gray-200 text-gray-900" : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
        <div className="inline-flex border border-gray-200 rounded-md overflow-hidden text-xs">
          {([
            { value: "sale", label: "Por venta" },
            { value: "patient", label: "Por paciente" },
          ] as const).map((v) => {
            const isActive = groupBy === v.value
            const qs = new URLSearchParams()
            if (statusFilter) qs.set("status", statusFilter)
            if (v.value === "patient") qs.set("view", "patient")
            const href = qs.toString() ? `/sales?${qs.toString()}` : "/sales"
            return (
              <Link
                key={v.value}
                href={href}
                className={`px-3 py-1 transition-colors ${
                  isActive ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {v.label}
              </Link>
            )
          })}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
        {sales.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            {t("noSalesFilter")}
          </p>
        ) : groupBy === "patient" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">Paciente</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">Cobrado</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">Pendiente</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">Pagos</th>
                {role !== "rep" && (
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden lg:table-cell">Rep</th>
                )}
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 hidden sm:table-cell">Última actividad</th>
              </tr>
            </thead>
            <tbody>
              {patientGroups.map((p) => (
                <tr key={p.leadId} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4">
                    <Link href={`/leads/${p.leadId}`} className="text-gray-800 hover:text-gray-900 transition-colors font-medium">
                      {p.leadName}
                    </Link>
                    {p.hasPlan && (
                      <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 font-normal border-blue-500/40 text-blue-500">
                        Plan
                      </Badge>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="text-emerald-600 font-medium tabular-nums">{fmtCents(p.paidCents)}</span>
                  </td>
                  <td className="py-3 pr-4">
                    {p.pendingCents > 0 ? (
                      <span className="text-amber-600 tabular-nums">{fmtCents(p.pendingCents)}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="text-xs text-gray-500 tabular-nums">{p.salesCount}</span>
                  </td>
                  {role !== "rep" && (
                    <td className="py-3 pr-4 hidden lg:table-cell">
                      <span className="text-xs text-gray-400">{p.repName ?? "—"}</span>
                    </td>
                  )}
                  <td className="py-3 hidden sm:table-cell">
                    <span className="text-xs text-gray-400">{fmtDate(p.lastDate)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                        <RepCellSelectClient
                          saleId={sale.id}
                          leadId={sale.lead?.id ?? null}
                          currentRepId={sale.rep?.id ?? null}
                          currentRepName={sale.rep?.name ?? null}
                          reps={brandReps}
                          canEdit={canReassign}
                        />
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
