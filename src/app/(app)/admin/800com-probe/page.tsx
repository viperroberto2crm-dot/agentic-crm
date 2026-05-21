import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { listCallsPage } from "@/lib/integrations/800com"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type TypedClient = SupabaseClient<Database>

export const dynamic = "force-dynamic"

export default async function EightHundredProbePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") redirect("/dashboard")

  let sampleCalls: unknown[] = []
  let sampleKeys: string[] = []
  let error: string | null = null

  try {
    const companyId = parseInt(process.env.EIGHTHUNDRED_COMPANY_ID ?? "0", 10)
    if (!companyId) throw new Error("EIGHTHUNDRED_COMPANY_ID env var missing")

    const startDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const endDate = new Date().toISOString()

    const page = await listCallsPage({
      companyId,
      startDate,
      endDate,
      perPage: 5,
    })

    sampleCalls = page.data
    if (page.data.length > 0) {
      sampleKeys = Object.keys(page.data[0] as Record<string, unknown>)
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">
        800.com — Diagnóstico de respuesta cruda
      </h1>
      <p className="text-sm text-gray-500">
        Esta página muestra el JSON crudo que 800.com devuelve para 1-5 llamadas
        de las últimas 24h. Sirve para encontrar el field exacto del nombre del
        caller (CNAM).
      </p>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          Error: {error}
        </div>
      )}

      {!error && (
        <>
          <div className="bg-white border border-gray-200 rounded p-4 space-y-2">
            <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
              Fields disponibles ({sampleKeys.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {sampleKeys.map((k) => {
                const isLikelyName = /name|contact|caller/i.test(k) && !/number|dialed|caller$/i.test(k)
                return (
                  <span
                    key={k}
                    className={`text-xs px-2 py-1 rounded font-mono ${
                      isLikelyName
                        ? "bg-emerald-100 text-emerald-700 border border-emerald-300 font-semibold"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {k}
                  </span>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Los fields resaltados en verde son candidatos a ser el nombre del caller.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded p-4">
            <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">
              JSON crudo de {sampleCalls.length} call(s)
            </p>
            <pre className="text-[11px] font-mono bg-gray-50 p-3 rounded overflow-x-auto max-h-[600px] overflow-y-auto whitespace-pre">
              {JSON.stringify(sampleCalls, null, 2)}
            </pre>
          </div>
        </>
      )}
    </div>
  )
}
