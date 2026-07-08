import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug, fetchTimezone } from "@/lib/queries/dashboard"
import { getSalesBreakdown } from "@/lib/queries/sales-kpi"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getLocale, getTranslations } from "next-intl/server"
import { ExportButton } from "@/components/exports/export-button"
import { ReportExportButton } from "@/components/exports/report-export-button"
import { BRAND_TIMEZONE } from "@/lib/datetime"
import { RepCellSelectClient } from "./_components/rep-cell-select-client"
import { PatientSearchInput } from "@/components/ui/patient-search-input"
import {
  resolveActiveRange,
  dateOnlyRangeToUtc,
  formatYmdForDisplay,
  type DashboardSearchParams,
} from "@/lib/dashboard/date-ranges"
import { DateRangeFilter } from "../dashboard/_components/date-range-filter"

export const dynamic = "force-dynamic"

type TypedClient = SupabaseClient<Database>

// Fallback dot colors by slug, mirrors leads-table-bulk's BRAND_COLORS.
const FALLBACK_COLORS: Record<string, string> = {
  "si-se-pierde": "#E11D48",
  "sunny-slim": "#F59E0B",
}

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
  // alias narrow para que tsc no se queje en funciones anidadas (redirect()
  // tiene return type `never` pero tsc no siempre lo propaga al closure scope)
  const userId = user.id

  const sb = supabase as unknown as TypedClient
  const t = await getTranslations("sales")
  const tc = await getTranslations("common")
  const tFilters = await getTranslations("dashboard.filters")
  const locale = await getLocale()

  const STATUS_CONFIG = {
    paid:     { label: t("paid"),     className: "border-[#2E8B6F]/40 text-[#2E8B6F]" },
    pending:  { label: t("pending"),  className: "border-[#D9A441]/40 text-[#D9A441]" },
    failed:   { label: t("failed"),   className: "border-[#E07856]/40 text-[#E07856]" },
    refunded: { label: t("refunded"), className: "border-[#E8E4DC] text-[#93A39D]" },
    partial:  { label: t("partial"),  className: "border-blue-500/30 text-blue-600" },
  } as const

  const [profileRes, cookieStore, params] = await Promise.all([
    sb.from("users").select("role").eq("id", user.id).single(),
    cookies(),
    searchParams,
  ])

  const role = (profileRes.data?.role ?? "rep") as string
  if (role === "provider") redirect("/appointments")
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const allMode = brandSlug === "__all__"
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  // "All companies" mode: strictly limit to the user's AUTHORIZED brands.
  // admin → every brand; non-admin → only their user_brands rows.
  let authorizedBrandIds: string[] = []
  const brandsById = new Map<
    string,
    { id: string; name: string; slug: string; brand_color: string | null }
  >()
  if (allMode) {
    if (role === "admin") {
      const { data: brandRows } = await sb.from("brands").select("id")
      authorizedBrandIds = (brandRows ?? []).map((b) => b.id as string)
    } else {
      const { data: ubRows } = await sb
        .from("user_brands")
        .select("brand_id")
        .eq("user_id", user.id)
      authorizedBrandIds = (ubRows ?? []).map((r) => r.brand_id as string)
    }
    // Display labels/colors only (names + colors, not sales data).
    const { data: brandRows } = await sb
      .from("brands")
      .select("id, name, slug, brand_color")
    for (const b of brandRows ?? []) {
      brandsById.set(b.id as string, {
        id: b.id as string,
        name: b.name as string,
        slug: b.slug as string,
        brand_color: (b.brand_color as string | null) ?? null,
      })
    }
  }

  const sp = params as Record<string, string | string[] | undefined>
  const statusFilter = typeof sp.status === "string" ? sp.status : null
  const groupBy = sp.view === "patient" ? "patient" : "sale"
  const searchTerm = typeof sp.search === "string" ? sp.search.trim() : null

  // Date range filter (mismo patrón que dashboard)
  const timezone = await fetchTimezone(sb, user.id)
  const active = resolveActiveRange(sp as DashboardSearchParams, timezone)
  const range = dateOnlyRangeToUtc(active.from, active.to, timezone)

  // Si hay búsqueda, primero saco los lead_ids que matchean
  let leadIdsFilter: string[] | null = null
  if (searchTerm && (brandId || (allMode && authorizedBrandIds.length > 0))) {
    const tokens = searchTerm.replace(/[(),]/g, " ").split(/\s+/).filter(Boolean)
    const orParts: string[] = []
    for (const tok of tokens) {
      const t = tok.replace(/%/g, "")
      orParts.push(`first_name.ilike.%${t}%`, `last_name.ilike.%${t}%`, `phone.ilike.%${t}%`)
    }
    const base = sb.from("leads").select("id")
    const scoped = allMode
      ? base.in("brand_id", authorizedBrandIds)
      : base.eq("brand_id", brandId!)
    const { data: matchingLeads } = await scoped.or(orParts.join(",")).limit(500)
    leadIdsFilter = (matchingLeads ?? []).map((l) => l.id)
    if (leadIdsFilter.length === 0) leadIdsFilter = ["00000000-0000-0000-0000-000000000000"]
  }

  // Filtro: cuando statusFilter es null (All) o "paid", mostramos sales con
  // MOVIMIENTO de dinero en rango (paid con paid_at en rango + partial/pending
  // con abonos en rango). Cuando es "pending" o "failed", mostramos sales
  // creadas en rango con ese status (backlog que necesita gestión).
  //
  // Antes filtrábamos toda la tabla por created_at, lo que mostraba leads
  // con planes registrados en rango aunque NO hubieran pagado nada — confuso
  // porque la suma de la tabla no cuadraba con el KPI Collected.

  const selectFields = `id, amount_cents, payment_method, payment_status, paid_at, created_at, notes, brand_id,
       lead:leads!sales_lead_id_fkey(id, first_name, last_name),
       rep:users!sales_rep_id_fkey(id, name)`

  type SaleRow = {
    id: string
    amount_cents: number
    payment_method: string
    payment_status: Database["public"]["Enums"]["payment_status"]
    paid_at: string | null
    created_at: string
    notes: string | null
    brand_id: string | null
    lead: { id: string; first_name: string; last_name: string | null } | null
    rep: { id: string; name: string } | null
  }

  async function fetchPaidInRange(): Promise<SaleRow[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = sb
      .from("sales")
      .select(selectFields)
      .eq("payment_status", "paid")
      .gte("paid_at", range.start)
      .lt("paid_at", range.end)
      .order("paid_at", { ascending: false })
      .limit(100)
    if (role === "rep") q = q.eq("rep_id", userId)
    if (allMode) q = q.in("brand_id", authorizedBrandIds.length ? authorizedBrandIds : ["00000000-0000-0000-0000-000000000000"])
    else if (brandId) q = q.eq("brand_id", brandId)
    if (leadIdsFilter) q = q.in("lead_id", leadIdsFilter)
    const { data } = await q
    return (data ?? []) as SaleRow[]
  }

  async function fetchOpenWithAbonoInRange(): Promise<SaleRow[]> {
    // Pasos: abonos en rango → plan_ids → sale_ids → sales partial/pending
    const { data: abonos } = await sb
      .from("abonos")
      .select("plan_id")
      .gte("paid_at", range.start.slice(0, 10))
      .lt("paid_at", range.end.slice(0, 10))
    const planIds = Array.from(new Set((abonos ?? []).map((a) => a.plan_id)))
    if (planIds.length === 0) return []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: plans } = await (sb as any)
      .from("payment_plans")
      .select("sale_id")
      .in("id", planIds)
    const saleIds = Array.from(
      new Set(
        ((plans ?? []) as Array<{ sale_id: string | null }>)
          .map((p) => p.sale_id)
          .filter((x): x is string => !!x),
      ),
    )
    if (saleIds.length === 0) return []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = sb
      .from("sales")
      .select(selectFields)
      .in("id", saleIds)
      .in("payment_status", ["partial", "pending"])
      .order("created_at", { ascending: false })
    if (role === "rep") q = q.eq("rep_id", userId)
    if (allMode) q = q.in("brand_id", authorizedBrandIds.length ? authorizedBrandIds : ["00000000-0000-0000-0000-000000000000"])
    else if (brandId) q = q.eq("brand_id", brandId)
    if (leadIdsFilter) q = q.in("lead_id", leadIdsFilter)
    const { data } = await q
    return (data ?? []) as SaleRow[]
  }

  async function fetchByCreatedInRange(
    status: Database["public"]["Enums"]["payment_status"],
  ): Promise<SaleRow[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = sb
      .from("sales")
      .select(selectFields)
      .eq("payment_status", status)
      .gte("created_at", range.start)
      .lt("created_at", range.end)
      .order("created_at", { ascending: false })
      .limit(100)
    if (role === "rep") q = q.eq("rep_id", userId)
    if (allMode) q = q.in("brand_id", authorizedBrandIds.length ? authorizedBrandIds : ["00000000-0000-0000-0000-000000000000"])
    else if (brandId) q = q.eq("brand_id", brandId)
    if (leadIdsFilter) q = q.in("lead_id", leadIdsFilter)
    const { data } = await q
    return (data ?? []) as SaleRow[]
  }

  let salesRaw: SaleRow[] = []
  if (statusFilter === "paid") {
    salesRaw = await fetchPaidInRange()
  } else if (statusFilter === "pending" || statusFilter === "failed") {
    salesRaw = await fetchByCreatedInRange(
      statusFilter as Database["public"]["Enums"]["payment_status"],
    )
  } else {
    // All: merge paid en rango + partial/pending con abono en rango
    const [paidR, openR] = await Promise.all([
      fetchPaidInRange(),
      fetchOpenWithAbonoInRange(),
    ])
    const seen = new Set<string>()
    salesRaw = [...paidR, ...openR]
      .filter((s) => {
        if (seen.has(s.id)) return false
        seen.add(s.id)
        return true
      })
      .sort((a, b) => {
        const da = a.paid_at ?? a.created_at
        const db = b.paid_at ?? b.created_at
        return db.localeCompare(da)
      })
      .slice(0, 100)
  }
  const count = salesRaw.length

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
    brand_id: string | null
    lead: { id: string; first_name: string; last_name: string | null } | null
    rep: { id: string; name: string } | null
  }

  const sales = (salesRaw ?? []) as unknown as SaleItem[]

  // Para la vista "Por paciente" traemos info de planes/abonos por sale para
  // calcular collected (en rango) y outstanding (balance real) correctamente.
  // Sin esto: paidCents/pendingCents usaban amount_cents total → inflaban en
  // sales paid con plan (sumaban cobros viejos) y en partial (sumaban total
  // del plan sin restar abonos hechos).
  type SalePlanInfo = {
    paidInRange: number
    paidAllTime: number
    totalAmount: number
  }
  const salePlanInfo = new Map<string, SalePlanInfo>()
  if (groupBy === "patient" && sales.length > 0) {
    const saleIds = sales.map((s) => s.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: plans } = await (sb as any)
      .from("payment_plans")
      .select("id, sale_id, total_amount_cents")
      .in("sale_id", saleIds)
    const planRows = (plans ?? []) as Array<{
      id: string
      sale_id: string
      total_amount_cents: number
    }>
    const planToSale = new Map<string, string>(planRows.map((p) => [p.id, p.sale_id]))

    if (planRows.length > 0) {
      const planIds = planRows.map((p) => p.id)
      const { data: abonos } = await sb
        .from("abonos")
        .select("plan_id, amount_cents, paid_at")
        .in("plan_id", planIds)
      const abonoRows = (abonos ?? []) as Array<{
        plan_id: string
        amount_cents: number
        paid_at: string
      }>
      const rangeStartDate = range.start.slice(0, 10)
      const rangeEndDate = range.end.slice(0, 10)
      for (const a of abonoRows) {
        const saleId = planToSale.get(a.plan_id)
        if (!saleId) continue
        let info = salePlanInfo.get(saleId)
        if (!info) {
          const sale = sales.find((s) => s.id === saleId)
          info = {
            paidInRange: 0,
            paidAllTime: 0,
            totalAmount: sale?.amount_cents ?? 0,
          }
          salePlanInfo.set(saleId, info)
        }
        info.paidAllTime += a.amount_cents
        if (a.paid_at >= rangeStartDate && a.paid_at < rangeEndDate) {
          info.paidInRange += a.amount_cents
        }
      }
    }
  }

  // Vista "Por paciente": agrupa ventas por lead.id y suma totales.
  type PatientGroup = {
    leadId: string
    leadName: string
    repName: string | null
    brandId: string | null
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
      const planInfo = salePlanInfo.get(s.id)
      const hasPlan = planInfo != null

      // Calcular collected en rango y outstanding REAL para esta sale.
      // - Con plan: collected = abonos en rango. outstanding = total - todos los abonos.
      // - Sin plan: collected = amount si paid. outstanding = amount si pending/partial.
      let saleCollected: number
      let saleOutstanding: number
      if (hasPlan) {
        saleCollected = planInfo!.paidInRange
        saleOutstanding = Math.max(0, planInfo!.totalAmount - planInfo!.paidAllTime)
      } else {
        const isPaid = s.payment_status === "paid"
        const isOpen = s.payment_status === "partial" || s.payment_status === "pending"
        saleCollected = isPaid ? s.amount_cents : 0
        saleOutstanding = isOpen ? s.amount_cents : 0
      }

      const existing = map.get(id)
      if (!existing) {
        map.set(id, {
          leadId: id,
          leadName: name,
          repName: s.rep?.name ?? null,
          brandId: s.brand_id,
          salesCount: 1,
          paidCents: saleCollected,
          pendingCents: saleOutstanding,
          lastDate: dateIso,
          hasPlan,
        })
      } else {
        existing.salesCount += 1
        existing.paidCents += saleCollected
        existing.pendingCents += saleOutstanding
        if (dateIso > existing.lastDate) existing.lastDate = dateIso
        if (hasPlan) existing.hasPlan = true
      }
    }
    return Array.from(map.values()).sort((a, b) => b.lastDate.localeCompare(a.lastDate))
  })()

  // KPIs agregados — usa el helper compartido para consistencia con Dashboard
  // paidRange filtra solo lo COBRADO en el rango (lo pendiente no se filtra por
  // fecha porque "outstanding" siempre es total acumulado)
  const breakdown = await getSalesBreakdown(sb, {
    brandId,
    repId: role === "rep" ? user.id : null,
    paidRange: { startIso: range.start, endIso: range.end },
  })
  const totalPaidCents = breakdown.collectedCents
  const totalPendingCents = breakdown.outstandingCents
  const paidCount = breakdown.paidCount
  const pendingCount = breakdown.openCount

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-xl font-semibold text-gray-900">{t("title")}</h1>
          <span className="text-[11px] text-gray-400">
            {tFilters("showing", {
              from: formatYmdForDisplay(active.from, locale),
              to: formatYmdForDisplay(active.to, locale),
            })}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <DateRangeFilter
            preset={active.preset}
            from={active.from}
            to={active.to}
            timezone={timezone}
          />
          <p className="text-xs text-gray-400">{count ?? sales.length} {tc("records")}</p>
          <ReportExportButton defaultBrand={brandSlug ?? ""} />
          <ExportButton entity="sales" extraParams={{ status: statusFilter }} />
        </div>
      </div>

      <PatientSearchInput placeholder={tc("searchPatientPlaceholder")} />

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
            { value: "sale", label: t("viewBySale") },
            { value: "patient", label: t("viewByPatient") },
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
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("colPatient")}</th>
                {allMode && (
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{tc("colCompany")}</th>
                )}
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("colCollected")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("colOutstanding")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("colPayments")}</th>
                {role !== "rep" && (
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden lg:table-cell">{tc("colRep")}</th>
                )}
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 hidden sm:table-cell">{t("colLastActivity")}</th>
              </tr>
            </thead>
            <tbody>
              {patientGroups.map((p) => {
                const brand = allMode && p.brandId ? brandsById.get(p.brandId) : null
                return (
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
                  {allMode && (
                    <td className="py-3 pr-4">
                      {brand ? (
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: brand.brand_color ?? FALLBACK_COLORS[brand.slug] ?? "#3B82F6" }}
                          />
                          <span className="text-xs text-gray-500 truncate max-w-[140px]">{brand.name}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  )}
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
                )
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("colLead")}</th>
                {allMode && (
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{tc("colCompany")}</th>
                )}
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
                const brand = allMode && sale.brand_id ? brandsById.get(sale.brand_id) : null
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
                    {allMode && (
                      <td className="py-3 pr-4">
                        {brand ? (
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: brand.brand_color ?? FALLBACK_COLORS[brand.slug] ?? "#3B82F6" }}
                            />
                            <span className="text-xs text-gray-500 truncate max-w-[140px]">{brand.name}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    )}
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
