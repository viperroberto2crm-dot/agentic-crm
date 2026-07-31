import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import { Plus, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { fetchLeads, fetchLeadsByActivity } from "@/lib/queries/leads"
import { getBrandIdBySlug, fetchTimezone } from "@/lib/queries/dashboard"
import { fetchLeadsStats, type LeadsStats } from "@/lib/queries/leads-stats"
import {
  resolveActiveRange,
  dateOnlyRangeToUtc,
  isValidYmd,
  ymdFromDateInTz,
  type DateRangePreset,
} from "@/lib/dashboard/date-ranges"
import { computeCoverageForLeads } from "@/lib/coverage/coverage"
import { computeOwedForLeads, owedLeadIdsInScope } from "@/lib/coverage/owed"
import { activeLeadIdsInRange } from "@/lib/queries/active-leads"
import { LeadFilterBar } from "./_components/filter-bar"
import { LeadsDateFilter } from "./_components/leads-date-filter"
import type { CoverageCell } from "./_components/leads-table-bulk"
import { LeadsStatStrip } from "./_components/leads-stat-strip"
import { LeadsTableBulk } from "./_components/leads-table-bulk"
import { logQuickCall } from "./actions"
import { getTranslations } from "next-intl/server"
import { ExportButton } from "@/components/exports/export-button"

type TypedClient = SupabaseClient<Database>

// Fecha corta para la etiqueta "Cubierto · 15 ago". Se formatea en la MISMA
// timezone con la que se decidió la cobertura, para que no discrepen por un día.
function fmtCoverageDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("es-US", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
  }).format(new Date(iso))
}

// Monto para la etiqueta "Debe $75" (sin centavos si es entero).
function fmtMoney(cents: number): string {
  const dollars = cents / 100
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: dollars % 1 === 0 ? 0 : 2,
  })
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const t = await getTranslations("leads")
  const ts = await getTranslations("status")
  const tCommon = await getTranslations("common")

  const [profileRes, cookieStore, params] = await Promise.all([
    sb.from("users").select("role").eq("id", user.id).single(),
    cookies(),
    searchParams,
  ])

  const role = (profileRes.data?.role ?? "rep") as string
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const allMode = brandSlug === "__all__"
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  const sp = params as Record<string, string | string[] | undefined>
  const status = typeof sp.status === "string" ? sp.status : null
  const source = typeof sp.source === "string" ? sp.source : null
  const search = typeof sp.search === "string" ? sp.search : null
  const offset = typeof sp.offset === "string" ? parseInt(sp.offset, 10) : 0

  // Providers can only see leads they have at least one appointment with.
  let providerLeadIds: string[] | null = null
  if (role === "provider") {
    const { data: leadIdsRows } = await sb
      .from("appointments")
      .select("lead_id")
      .eq("provider_id", user.id)
      .not("lead_id", "is", null)
    providerLeadIds = Array.from(
      new Set(
        (leadIdsRows ?? [])
          .map((r) => r.lead_id)
          .filter((x): x is string => Boolean(x))
      )
    )
  }

  // "All companies" mode: strictly limit to the user's AUTHORIZED brands.
  // admin → every brand; non-admin → only their user_brands rows.
  let authorizedBrandIds: string[] | undefined
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
  }

  const showCompany = allMode

  const timezone = await fetchTimezone(sb, user.id)

  // Filtro de fecha (opcional). Muestra a los pacientes con ACTIVIDAD en el
  // periodo — entró (lead nuevo), pagó/venta, cita o llamada — no solo a los
  // creados ese día. Por defecto NO filtra (muestra todos).
  const fromParam = typeof sp.from === "string" ? sp.from : null
  const toParam = typeof sp.to === "string" ? sp.to : null
  const presetParam = typeof sp.preset === "string" ? sp.preset : null
  const todayYmd = ymdFromDateInTz(new Date(), timezone)
  let dateFilter: { active: boolean; from: string; to: string; preset: DateRangePreset } = {
    active: false, from: todayYmd, to: todayYmd, preset: "custom",
  }
  let activeIds: string[] | null = null // ids con actividad en el periodo
  if (fromParam && toParam && isValidYmd(fromParam) && isValidYmd(toParam) && fromParam <= toParam) {
    const range = resolveActiveRange(
      { from: fromParam, to: toParam, preset: presetParam ?? undefined },
      timezone,
    )
    const utc = dateOnlyRangeToUtc(range.from, range.to, timezone)
    dateFilter = { active: true, from: range.from, to: range.to, preset: range.preset }
    activeIds = await activeLeadIdsInRange(sb, utc.start, utc.end)
  }

  // Filtro "Debe" (saldo pendiente > 0).
  const debeActive = sp.debe === "1"

  // Set de restricción por actividad-en-periodo y/o deuda. El scope de provider
  // va como allow-list normal (filters.leadIds), NO en este set.
  let constraintSet: Set<string> | null = null
  if (activeIds) constraintSet = new Set(activeIds)
  if (debeActive) {
    const owedSet = new Set(await owedLeadIdsInScope(sb))
    constraintSet = constraintSet
      ? new Set([...constraintSet].filter((id) => owedSet.has(id)))
      : owedSet
  }

  const baseFilters = {
    brandId: allMode ? null : brandId,
    brandIds: authorizedBrandIds,
    status,
    source,
    search,
    leadIds: providerLeadIds,
    limit: 50,
    offset,
  }
  const { leads, total } = constraintSet
    ? await fetchLeadsByActivity(sb, user.id, role, baseFilters, constraintSet)
    : await fetchLeads(sb, user.id, role, baseFilters)

  // Tira de stats (arriba de la tabla). Solo no-provider. Scope idéntico al de
  // la lista. Revisado con Fable: sin fuga de marca, semana/mes con timezone.
  let leadsStats: LeadsStats | null = null
  if (role !== "provider") {
    leadsStats = await fetchLeadsStats(sb, {
      userId: user.id,
      role,
      brandId: allMode ? null : brandId,
      brandIds: authorizedBrandIds,
      timezone,
    })
  }

  // Cobertura de prepago (etiqueta 🟢/🟡/🔴). Solo no-provider. Se calcula solo
  // para los pacientes visibles en esta página (≤50). Los leadIds ya vienen con
  // el alcance de marca del usuario (fetchLeads) → el admin client de coverage
  // no amplía visibilidad, solo lee pagos de pacientes que el usuario YA ve.
  let coverageById: Record<string, CoverageCell> | undefined
  if (role !== "provider" && leads.length > 0) {
    const leadIdList = leads.map((l) => l.id)
    const [cov, owed] = await Promise.all([
      computeCoverageForLeads(leadIdList, timezone),
      computeOwedForLeads(leadIdList),
    ])
    coverageById = {}
    for (const l of leads) {
      const c = cov.get(l.id)
      const owedCents = owed.get(l.id) ?? 0
      coverageById[l.id] = {
        state: c?.state ?? "none",
        until: c?.coveredUntil ? fmtCoverageDate(c.coveredUntil, timezone) : null,
        hadPayment: c?.hadPayment ?? false,
        owed: owedCents > 0 ? fmtMoney(owedCents) : null,
      }
    }
  }

  // Reps disponibles para reasignar bulk (admin/manager only).
  // En modo "todas las compañías" se omite: la reasignación bulk necesita un
  // solo brand, así que se pasa brandReps=[] (bulk delete sigue funcionando).
  const canReassign = role === "admin" || role === "manager"
  let brandReps: { id: string; name: string }[] = []
  if (canReassign && !allMode && brandId) {
    // 1) Sacar user_ids del brand
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ubData } = await (sb as any)
      .from("user_brands")
      .select("user_id")
      .eq("brand_id", brandId)
    const userIds = ((ubData ?? []) as { user_id: string }[]).map((r) => r.user_id)
    // 2) Sacar info de esos users
    if (userIds.length > 0) {
      const { data: repsData } = await sb
        .from("users")
        .select("id, name")
        .in("id", userIds)
        .eq("active", true)
        .in("role", ["admin", "manager", "rep"])
        .order("name")
      brandReps = (repsData ?? []).map((u) => ({
        id: u.id as string,
        name: (u.name as string | null) ?? "—",
      }))
    }
  }

  const LIMIT = 50
  const dateQs: Record<string, string> = {
    ...(dateFilter.active
      ? { from: dateFilter.from, to: dateFilter.to, preset: dateFilter.preset }
      : {}),
    ...(debeActive ? { debe: "1" } : {}),
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[#20342C]">{t("title")}</h1>
          {/* Conteo prominente: es la respuesta a "cuántos pacientes" del filtro. */}
          <p className="mt-1.5 leading-none flex items-baseline gap-1.5">
            <span className="text-3xl font-bold text-[#20342C] tabular-nums">{total.toLocaleString()}</span>
            <span className="text-base font-semibold text-[#5C6F68]">
              {total === 1 ? "paciente" : "pacientes"}
            </span>
            {dateFilter.active && (
              <span className="text-sm font-medium text-[#EF7B5C]">· {t("dateFiltered")}</span>
            )}
          </p>
          <p className="text-[11px] text-[#B7C2BC] mt-1 leading-snug">
            las consultas de la publicidad entran solas 🌿
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {role !== "provider" && (
            <ExportButton
              entity="leads"
              extraParams={{
                status,
                source,
                search,
                ...(dateFilter.active ? { from: dateFilter.from, to: dateFilter.to } : {}),
                ...(debeActive ? { debe: "1" } : {}),
              }}
            />
          )}
          {role !== "rep" && role !== "provider" && (
            <>
              <Button asChild size="sm" variant="outline"
                className="h-9 text-xs gap-1.5 cursor-pointer border-gray-300 text-gray-700 hover:text-gray-900 hover:bg-gray-100"
              >
                <Link href="/leads/import">
                  <Upload className="w-3.5 h-3.5" />
                  {t("importLeads")}
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline"
                className="h-9 text-xs gap-1.5 cursor-pointer border-gray-300 text-gray-700 hover:text-gray-900 hover:bg-gray-100"
              >
                <Link href="/leads/import-plans">
                  <Upload className="w-3.5 h-3.5" />
                  Import plans
                </Link>
              </Button>
            </>
          )}
          {role !== "provider" && (
            <Button asChild size="sm" className="h-9 text-xs gap-1.5 cursor-pointer rounded-xl text-white shadow-[0_8px_20px_-8px_rgba(226,101,63,0.6)]" style={{ background: "linear-gradient(150deg,#EF7B5C,#E2653F)" }}>
              <Link href="/leads/new">
                <Plus className="w-3.5 h-3.5" />
                {t("newLead")}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {leadsStats && (
        <LeadsStatStrip
          stats={leadsStats}
          showUnassigned={role === "admin" || role === "manager"}
        />
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <LeadsDateFilter
          active={dateFilter.active}
          preset={dateFilter.preset}
          from={dateFilter.from}
          to={dateFilter.to}
          timezone={timezone}
        />
      </div>

      <LeadFilterBar total={total} showRepFilter={role !== "rep"} />

      <div className="bg-card border border-[#ECE3D3] rounded-2xl px-4 py-1 shadow-[0_1px_2px_rgba(26,46,40,0.05),0_10px_28px_-14px_rgba(26,46,40,0.12)]">
        <LeadsTableBulk
          leads={leads}
          canBulkDelete={role === "admin" || role === "manager"}
          brandReps={brandReps}
          showCompany={showCompany}
          logQuickCall={logQuickCall}
          coverageById={coverageById}
          coverageLabels={{
            covered: t("coverageCovered"),
            unknown: t("coverageUnknown"),
            debt: t("coverageDebt"),
          }}
          statusLabels={{
            new: ts("new"),
            contacted: ts("contacted"),
            qualified: ts("qualified"),
            appointment_set: ts("appointment_set"),
            sold: ts("sold"),
            lost: ts("lost"),
            on_hold: ts("on_hold"),
            not_interested: ts("not_interested"),
          }}
          labels={{
            noLeadsFilter: t("noLeadsFilter"),
            createNew: t("createNew"),
            quickCallTitle: t("quickCallTitle"),
            colLastContact: t("colLastContact"),
            colCompany: t("company"),
            deleteSelected: t("deleteSelected"),
            deleting: t("deleting"),
            deleteConfirmTitle: t("deleteBulkConfirm"),
            deleteConfirmDesc: t("deleteBulkWarning"),
            deleteConfirmAll: t("deleteBulkConfirmBtn"),
            cancel: tCommon("cancel"),
            selectAll: t("selectAll"),
          }}
        />
      </div>

      {total > LIMIT && (
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>
            {t("showing", { from: offset + 1, to: Math.min(offset + leads.length, total), total })}
          </span>
          <div className="flex gap-2">
            {offset > 0 && (
              <Link href={`/leads?${new URLSearchParams({ ...(status ? { status } : {}), ...(source ? { source } : {}), ...(search ? { search } : {}), ...dateQs, offset: String(offset - LIMIT) })}`}
                className="px-3 py-1 border border-gray-200 rounded hover:border-gray-300 transition-colors"
              >
                ← {tCommon("previous")}
              </Link>
            )}
            {offset + LIMIT < total && (
              <Link href={`/leads?${new URLSearchParams({ ...(status ? { status } : {}), ...(source ? { source } : {}), ...(search ? { search } : {}), ...dateQs, offset: String(offset + LIMIT) })}`}
                className="px-3 py-1 border border-gray-200 rounded hover:border-gray-300 transition-colors"
              >
                {tCommon("next")} →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
