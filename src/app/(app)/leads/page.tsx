import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import { Plus, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { fetchLeads } from "@/lib/queries/leads"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { LeadFilterBar } from "./_components/filter-bar"
import { LeadsTableBulk } from "./_components/leads-table-bulk"
import { logQuickCall } from "./actions"
import { getTranslations } from "next-intl/server"
import { ExportButton } from "@/components/exports/export-button"

type TypedClient = SupabaseClient<Database>

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
      .eq("rep_id", user.id)
      .not("lead_id", "is", null)
    providerLeadIds = Array.from(
      new Set(
        (leadIdsRows ?? [])
          .map((r) => r.lead_id)
          .filter((x): x is string => Boolean(x))
      )
    )
  }

  const { leads, total } = await fetchLeads(sb, user.id, role, {
    brandId, status, source, search, leadIds: providerLeadIds,
    limit: 50, offset,
  })

  const LIMIT = 50

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-gray-900">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <ExportButton
            entity="leads"
            extraParams={{ status, source, search }}
          />
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
            <Button asChild size="sm" className="h-9 text-xs gap-1.5 cursor-pointer" style={{ background: "var(--brand)" }}>
              <Link href="/leads/new">
                <Plus className="w-3.5 h-3.5" />
                {t("newLead")}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <LeadFilterBar total={total} showRepFilter={role !== "rep"} />

      <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
        <LeadsTableBulk
          leads={leads}
          canBulkDelete={role === "admin" || role === "manager"}
          logQuickCall={logQuickCall}
          statusLabels={{
            new: ts("new"),
            contacted: ts("contacted"),
            qualified: ts("qualified"),
            appointment_set: ts("appointment_set"),
            sold: ts("sold"),
            lost: ts("lost"),
            on_hold: ts("on_hold"),
          }}
          labels={{
            noLeadsFilter: t("noLeadsFilter"),
            createNew: t("createNew"),
            quickCallTitle: t("quickCallTitle"),
            colLastContact: t("colLastContact"),
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
              <Link href={`/leads?${new URLSearchParams({ ...(status ? { status } : {}), ...(source ? { source } : {}), ...(search ? { search } : {}), offset: String(offset - LIMIT) })}`}
                className="px-3 py-1 border border-gray-200 rounded hover:border-gray-300 transition-colors"
              >
                ← {tCommon("previous")}
              </Link>
            )}
            {offset + LIMIT < total && (
              <Link href={`/leads?${new URLSearchParams({ ...(status ? { status } : {}), ...(source ? { source } : {}), ...(search ? { search } : {}), offset: String(offset + LIMIT) })}`}
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
