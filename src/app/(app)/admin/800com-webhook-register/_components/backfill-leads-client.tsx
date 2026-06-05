"use client"

import { useState, useTransition } from "react"
import {
  backfillLeadsForOrphanCalls,
  type BackfillLeadsResult,
} from "../backfill-actions"

/**
 * UI para crear leads automáticamente desde las calls de 800.com que
 * tienen lead_id NULL (las que aparecen como "—" en /calls).
 *
 * Usa la info del caller que 800.com manda (enhancedCallerId / contact)
 * para extraer nombre + phone. Si el caller no tiene nombre, queda como
 * estaba (skipped).
 *
 * Safe: solo INSERT leads nuevos + UPDATE calls que estaban NULL. Nunca
 * modifica leads existentes ni calls con lead_id ya asignado.
 */
export function BackfillLeadsClient() {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    return d.toISOString().slice(0, 10)
  })
  const [dryRun, setDryRun] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<BackfillLeadsResult | null>(null)

  function handleRun() {
    setResult(null)
    startTransition(async () => {
      const res = await backfillLeadsForOrphanCalls({ fromDate, dryRun })
      setResult(res)
    })
  }

  return (
    <div className="space-y-3 pt-4 border-t border-gray-200">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">
          Backfill leads para calls sin nombre
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Recorre las calls del CRM con LEAD = &quot;—&quot; (sin lead asignado), busca
          la info del caller en 800.com API (nombre + teléfono), crea el lead
          si tiene nombre, y linkea la call. Las que no tienen nombre en
          800.com quedan como están.
        </p>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5">
            Desde fecha
          </label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            disabled={isPending}
            className="h-9 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-800"
          />
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer h-9">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={isPending}
            className="w-3.5 h-3.5"
          />
          <span className="text-xs text-gray-700">
            Modo prueba (solo mostrar, NO crear todavía)
          </span>
        </label>
        <button
          type="button"
          onClick={handleRun}
          disabled={isPending}
          className={`h-9 px-4 rounded-md text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
            dryRun ? "bg-zinc-900 hover:bg-zinc-800" : "bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          {isPending
            ? "Procesando…"
            : dryRun
              ? "👀 PASO 3A: Previsualizar leads a crear"
              : "✅ PASO 3B: CREAR leads y linkear ahora (definitivo)"}
        </button>
      </div>

      {result && result.ok && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs space-y-2">
          <p className="font-semibold text-emerald-900">
            ✓ {result.dry_run ? "Dry run completado" : "Backfill completado"}
          </p>
          <ul className="text-emerald-800 list-disc list-inside space-y-1">
            <li>
              <strong>{result.total_orphans}</strong> calls con &quot;—&quot;
              encontradas en rango
            </li>
            <li>
              <strong>{result.leads_created}</strong> leads{" "}
              {result.dry_run ? "se crearían" : "creados"}
            </li>
            <li>
              <strong>{result.leads_matched_existing}</strong> matcheados con
              leads existentes (por phone)
            </li>
            <li>
              <strong>{result.calls_updated}</strong> calls{" "}
              {result.dry_run ? "se linkearían" : "linkeadas"}
            </li>
            <li className="text-amber-700">
              <strong>{result.skipped_no_info}</strong> sin info de caller
              en 800.com (no se puede crear lead)
            </li>
          </ul>

          {result.sample_created.length > 0 && (
            <details className="pt-1">
              <summary className="cursor-pointer text-emerald-900 font-medium text-xs">
                Ver muestra de leads {result.dry_run ? "que se crearían" : "creados"} (primeros 10)
              </summary>
              <pre className="mt-1 p-2 bg-white border border-emerald-200 rounded text-[10px] text-emerald-900 overflow-x-auto max-h-48">
                {result.sample_created
                  .map((l) => `${l.name} · ${l.phone}`)
                  .join("\n")}
              </pre>
            </details>
          )}

          {result.dry_run && result.leads_created > 0 && (
            <p className="text-emerald-900 font-medium text-xs pt-1">
              👉 Si se ve bien, destildá &quot;Dry run&quot; y click &quot;Crear
              leads y linkear&quot; para aplicar.
            </p>
          )}
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <p className="font-semibold">✗ Error</p>
          <p className="mt-1">{result.error}</p>
        </div>
      )}
    </div>
  )
}
