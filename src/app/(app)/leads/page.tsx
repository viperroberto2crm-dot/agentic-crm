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
import { LeadsTable } from "./_components/leads-table"
import { logQuickCall } from "./actions"

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

  const { leads, total } = await fetchLeads(sb, user.id, role, {
    brandId,
    status,
    source,
    search,
    limit: 50,
    offset,
  })

  const LIMIT = 50

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-100">Leads</h1>
        <div className="flex items-center gap-2">
          {role !== "rep" && (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="h-9 text-xs gap-1.5 cursor-pointer border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800"
            >
              <Link href="/leads/import">
                <Upload className="w-3.5 h-3.5" />
                Importar
              </Link>
            </Button>
          )}
          <Button
            asChild
            size="sm"
            className="h-9 text-xs gap-1.5 cursor-pointer"
            style={{ background: "var(--brand)" }}
          >
            <Link href="/leads/new">
              <Plus className="w-3.5 h-3.5" />
              Nuevo lead
            </Link>
          </Button>
        </div>
      </div>

      {/* Filter bar (client component) */}
      <LeadFilterBar total={total} showRepFilter={role !== "rep"} />

      {/* Table */}
      <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-lg px-4 py-2">
        <LeadsTable leads={leads} logQuickCall={logQuickCall} />
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between text-xs text-zinc-600">
          <span>
            Mostrando {offset + 1}–{Math.min(offset + leads.length, total)} de {total}
          </span>
          <div className="flex gap-2">
            {offset > 0 && (
              <Link
                href={`/leads?${new URLSearchParams({
                  ...(status ? { status } : {}),
                  ...(source ? { source } : {}),
                  ...(search ? { search } : {}),
                  offset: String(offset - LIMIT),
                })}`}
                className="px-3 py-1 border border-zinc-800 rounded hover:border-zinc-700 transition-colors"
              >
                ← Anterior
              </Link>
            )}
            {offset + LIMIT < total && (
              <Link
                href={`/leads?${new URLSearchParams({
                  ...(status ? { status } : {}),
                  ...(source ? { source } : {}),
                  ...(search ? { search } : {}),
                  offset: String(offset + LIMIT),
                })}`}
                className="px-3 py-1 border border-zinc-800 rounded hover:border-zinc-700 transition-colors"
              >
                Siguiente →
              </Link>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
