import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type TypedClient = SupabaseClient<Database>

export const dynamic = "force-dynamic"

const API_BASE = "https://api.800.com"

/**
 * Prueba varios endpoints posibles para encontrar la fuente del CNAM en 800.com.
 * El list /v2/calls no trae nombres — viven en otro lado.
 */
async function tryEndpoint(path: string, apiKey: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      cache: "no-store",
    })
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = await res.text()
    }
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    return { ok: false, status: 0, body: { error: e instanceof Error ? e.message : String(e) } }
  }
}

export default async function EightHundredContactsProbe() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") redirect("/dashboard")

  const apiKey = process.env.EIGHTHUNDRED_API_KEY
  let companyId = parseInt(process.env.EIGHTHUNDRED_COMPANY_ID ?? "0", 10)
  if (!companyId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (sb as any)
      .from("tracking_numbers")
      .select("provider_metadata")
      .eq("provider", "800com")
      .limit(1)
      .maybeSingle()
    const fromMeta = data?.provider_metadata?.company_id
    if (typeof fromMeta === "number") companyId = fromMeta
  }

  if (!apiKey || !companyId) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Faltan env vars</h1>
        <pre className="text-xs">apiKey: {apiKey ? "✓ set" : "✗ missing"} | companyId: {companyId || "✗ missing"}</pre>
      </div>
    )
  }

  // Probar varios endpoints potenciales
  const samplePhone = "+17149260731" // caller que aparece varias veces en el sample
  const probes = await Promise.all([
    tryEndpoint(`/v2/contacts?companyId=${companyId}&perPage=5`, apiKey).then((r) => ({ name: "GET /v2/contacts?companyId=X", ...r })),
    tryEndpoint(`/v2/contacts?companyId=${companyId}&phone=${encodeURIComponent(samplePhone)}`, apiKey).then((r) => ({ name: `GET /v2/contacts?phone=${samplePhone}`, ...r })),
    tryEndpoint(`/v2/calls/137502582`, apiKey).then((r) => ({ name: "GET /v2/calls/{id} (call detail)", ...r })),
    tryEndpoint(`/v2/companies/${companyId}/contacts?perPage=5`, apiKey).then((r) => ({ name: "GET /v2/companies/{id}/contacts", ...r })),
    tryEndpoint(`/contacts?companyId=${companyId}&perPage=5`, apiKey).then((r) => ({ name: "GET /contacts (v1)", ...r })),
    tryEndpoint(`/v2/cnam/${encodeURIComponent(samplePhone)}`, apiKey).then((r) => ({ name: `GET /v2/cnam/${samplePhone}`, ...r })),
  ])

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">
        800.com — Probe de endpoints para nombres (CNAM/Contacts)
      </h1>
      <p className="text-sm text-gray-500">
        Confirmamos que `/v2/calls` NO trae nombres. Esta página prueba varios endpoints donde podrían vivir.
        Los que devuelvan 200 con datos útiles son los buenos.
      </p>

      {probes.map((probe) => (
        <div key={probe.name} className="bg-white border border-gray-200 rounded p-4 space-y-2">
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-0.5 rounded font-mono font-semibold ${
              probe.ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
            }`}>
              {probe.status}
            </span>
            <span className="font-mono text-sm">{probe.name}</span>
          </div>
          <pre className="text-[11px] font-mono bg-gray-50 p-3 rounded overflow-x-auto max-h-60 overflow-y-auto whitespace-pre">
            {typeof probe.body === "string" ? probe.body : JSON.stringify(probe.body, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  )
}
