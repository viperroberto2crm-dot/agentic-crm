import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { countCandidates } from "./actions"
import { BackfillClient } from "./_components/backfill-client"

type TypedClient = SupabaseClient<Database>

export const dynamic = "force-dynamic"

export default async function EcidBackfillPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") redirect("/dashboard")

  const cookieStore = await cookies()
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  let candidateCount = 0
  let countError: string | null = null
  try {
    candidateCount = await countCandidates(brandId)
  } catch (e) {
    countError = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          800.com ECID — Backfill masivo
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Enriquece leads que NO tienen <code>address_line1</code> con datos de 800.com ECID
          (nombre, dirección, email, carrier). Filtrado por la marca activa{" "}
          {brandSlug ? <code>{brandSlug}</code> : <em>(todas)</em>}.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded p-4 text-xs text-amber-800 space-y-1">
        <p className="font-semibold">⚠️ Garantías del backfill:</p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>Solo enriquece leads con <code>address_line1 IS NULL</code> y phone presente.</li>
          <li>NUNCA sobrescribe campos que ya tengan valor (excepto first_name si parece teléfono).</li>
          <li>NO toca: appointments, sales, payment_plans, abonos, calls, notes, status.</li>
          <li>Rate limit: 1.2s entre lookups (≈ 50/min, bajo el límite de 60/min).</li>
          <li>Cache hits no se cobran. Live lookups cuestan según tu plan.</li>
        </ul>
      </div>

      {countError ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          Error contando candidatos: {countError}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded p-4">
          <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
            Candidatos en esta marca
          </p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">
            {candidateCount}{" "}
            <span className="text-sm font-normal text-gray-500">
              leads sin dirección
            </span>
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Costo estimado peor caso (todos live, sin cache): ~$
            {(candidateCount * 0.1).toFixed(2)}. Con cache hits suele ser mucho menos.
          </p>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded p-4 text-xs text-amber-900">
        <p className="font-semibold mb-1">🛟 Backup recomendado ANTES del run real:</p>
        <pre className="bg-white border border-amber-200 rounded p-2 overflow-x-auto whitespace-pre text-amber-900 text-[11px]">
{`CREATE TABLE leads_backup_2026_05_27_before_ecid AS
SELECT * FROM leads;`}
        </pre>
        <p className="mt-1.5">
          Si algo sale mal, restauras con <code>INSERT INTO leads SELECT * FROM leads_backup_2026_05_27_before_ecid ON CONFLICT (id) DO UPDATE SET ...</code>
        </p>
      </div>

      <BackfillClient brandId={brandId} maxCandidates={candidateCount} />
    </div>
  )
}
