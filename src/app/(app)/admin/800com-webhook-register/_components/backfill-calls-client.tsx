"use client"

import { useState, useTransition } from "react"
import { backfillCallsFromEightHundred, type BackfillResult } from "../backfill-actions"

/**
 * UI para disparar el backfill de calls desde 800.com API.
 * Solo admin. Usa session auth (no necesita secret).
 */
export function BackfillCallsClient() {
  const [fromDate, setFromDate] = useState(() => {
    // Default: 7 días atrás
    const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    return d.toISOString().slice(0, 10)
  })
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<BackfillResult | null>(null)

  function handleRun() {
    setResult(null)
    startTransition(async () => {
      const res = await backfillCallsFromEightHundred({ fromDate })
      setResult(res)
    })
  }

  return (
    <div className="space-y-3 pt-4 border-t border-gray-200">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">
          Backfill calls desde 800.com API
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Trae calls de 800.com directamente vía API (no via webhook). Útil para recuperar
          llamadas perdidas mientras el webhook estuvo caído. Dedupea por external_id, así que
          es seguro correrlo varias veces. Toma 30s-3min según el rango.
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
        <button
          type="button"
          onClick={handleRun}
          disabled={isPending}
          className="h-9 px-4 rounded-md bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Corriendo backfill…" : "Run backfill"}
        </button>
      </div>

      {result && result.ok && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs space-y-1">
          <p className="font-semibold text-emerald-900">
            ✓ Backfill completado
          </p>
          <p className="text-emerald-800">
            Rango: {result.range.startDate.slice(0, 10)} → {result.range.endDate.slice(0, 10)}
          </p>
          <ul className="text-emerald-700 list-disc list-inside">
            <li><strong>{result.inserted}</strong> calls nuevas insertadas</li>
            <li><strong>{result.skipped_existing}</strong> ya existían (dedup por external_id)</li>
            <li><strong>{result.leads_matched}</strong> matcheadas con leads existentes</li>
            {result.errors.length > 0 && (
              <li className="text-amber-700">
                <strong>{result.errors.length}</strong> errores (ver consola para detalle)
              </li>
            )}
          </ul>
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-amber-700 font-medium">
                Ver errores
              </summary>
              <pre className="mt-1 p-2 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-900 overflow-x-auto max-h-32">
                {JSON.stringify(result.errors, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <p className="font-semibold">✗ Error en backfill</p>
          <p className="mt-1">{result.error}</p>
        </div>
      )}
    </div>
  )
}
