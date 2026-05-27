import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { lookupEnhancedCallerId } from "@/lib/integrations/800com"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type TypedClient = SupabaseClient<Database>

export const dynamic = "force-dynamic"

/**
 * Admin diagnostic page: test 800.com Enhanced Caller ID lookups.
 *
 * Cada submit hace UN lookup. Si el número fue buscado antes, viene de cache
 * (no se cobra de nuevo). Si forceLive=true, fuerza lookup nuevo (cobro).
 *
 * Acceso: solo admin. Útil ANTES de hacer backfill masivo para verificar:
 *   - El endpoint responde correctamente
 *   - El formato de los datos es el esperado
 *   - El costo por lookup es el que esperamos
 */
export default async function EcidTestPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; force?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") redirect("/dashboard")

  const params = await searchParams
  const phone = (params.phone ?? "").trim()
  const forceLive = params.force === "1"

  let result: Awaited<ReturnType<typeof lookupEnhancedCallerId>> | null = null
  let error: string | null = null

  if (phone) {
    try {
      result = await lookupEnhancedCallerId(phone, forceLive)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          800.com — Enhanced Caller ID (ECID) Test
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Hace UN lookup contra el endpoint <code>/v2/companies/{`{company}`}/ecid/lookups</code>.
          Útil para validar la integración antes del backfill masivo.
        </p>
        <p className="text-xs text-amber-600 mt-1">
          ⚠️ Cada live-lookup se cobra. Cache hits no se cobran de nuevo. Usa &quot;Force live&quot; con cuidado.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 bg-white border border-gray-200 rounded p-4">
        <div className="flex-1 min-w-[250px]">
          <label className="text-xs font-medium text-gray-500 block mb-1.5">
            Teléfono a buscar (E.164 o cualquier formato)
          </label>
          <input
            type="text"
            name="phone"
            defaultValue={phone}
            placeholder="+12066129093"
            className="w-full bg-white border border-gray-200 text-gray-800 rounded px-3 py-2 h-9 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input type="checkbox" name="force" value="1" defaultChecked={forceLive} />
          Force live (skip cache, $$$)
        </label>
        <button
          type="submit"
          className="h-9 px-4 text-sm font-medium text-white rounded"
          style={{ background: "var(--brand)" }}
        >
          Lookup
        </button>
      </form>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          Error: {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="bg-white border border-gray-200 rounded p-4">
            <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">
              Metadata
            </p>
            <table className="text-xs">
              <tbody>
                <tr>
                  <td className="text-gray-500 pr-3">Match status</td>
                  <td className="font-mono">
                    <span className={result.matchStatus === "found" ? "text-emerald-600" : "text-amber-600"}>
                      {result.matchStatus}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="text-gray-500 pr-3">Normalized phone</td>
                  <td className="font-mono">{result.normalizedPhone}</td>
                </tr>
                <tr>
                  <td className="text-gray-500 pr-3">Cache hit</td>
                  <td className="font-mono">
                    {result.cacheHit ? (
                      <span className="text-emerald-600">✓ cache (no charge)</span>
                    ) : (
                      <span className="text-amber-600">✗ live lookup (charged)</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="text-gray-500 pr-3">Requested at</td>
                  <td className="font-mono">{result.requestedAt}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {result.data && (
            <div className="bg-white border border-gray-200 rounded p-4">
              <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-3">
                Datos extraídos
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <Row label="Nombre" value={result.data.name} />
                <Row label="First name" value={result.data.firstName} />
                <Row label="Last name" value={result.data.lastName} />
                <Row label="Middle name" value={result.data.middleName} />
                <Row label="Dirección 1" value={result.data.streetLine_1} />
                <Row label="Dirección 2" value={result.data.streetLine_2} />
                <Row label="Ciudad" value={result.data.city} />
                <Row label="Estado" value={result.data.region} />
                <Row label="Postal code" value={result.data.postalCode} />
                <Row label="Zip+4" value={result.data.zip4} />
                <Row label="País" value={result.data.country} />
                <Row label="Address type" value={result.data.addressDeliveryPoint} />
                <Row label="Address location" value={result.data.addressLocationType} />
                <Row label="Carrier" value={result.data.carrier} />
                <Row label="Line type" value={result.data.lineType} />
                <Row label="Age range" value={result.data.ageRange} />
                <Row label="Gender" value={result.data.gender} />
                <Row label="Type" value={result.data.type} />
              </div>
              {result.data.emails.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-1">Emails</p>
                  <ul className="text-sm font-mono">
                    {result.data.emails.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.data.alternativeNames.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-1">Alt names</p>
                  <ul className="text-sm">
                    {result.data.alternativeNames.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.data.industries.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-1">Industries</p>
                  <ul className="text-sm">
                    {result.data.industries.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <details className="bg-white border border-gray-200 rounded p-4">
            <summary className="text-xs uppercase tracking-wider text-gray-400 font-semibold cursor-pointer">
              JSON crudo
            </summary>
            <pre className="text-[11px] font-mono bg-gray-50 p-3 rounded overflow-x-auto mt-3 whitespace-pre">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex">
      <span className="text-gray-500 w-32 shrink-0">{label}:</span>
      <span className={value ? "text-gray-800" : "text-gray-300"}>
        {value ?? "—"}
      </span>
    </div>
  )
}
