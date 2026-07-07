"use client"

import { useState, useTransition } from "react"
import { Eye, CheckCircle2, ArrowRight } from "lucide-react"
import {
  syncTrackingNumbersFromEightHundred,
  type SyncTrackingResult,
} from "../backfill-actions"

/**
 * UI para sincronizar tracking numbers de la company A&O de 800.com
 * hacia la tabla `tracking_numbers` del CRM.
 *
 * Sin esto, las llamadas a numbers no registrados se descartan silenciosamente
 * en resolveTracking del webhook receiver. Después de sincronizar + correr
 * backfill, las llamadas históricas y futuras de esos numbers entran al CRM.
 */
export function SyncTrackingClient() {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<SyncTrackingResult | null>(null)
  const [dryRun, setDryRun] = useState(true)

  function handleRun() {
    setResult(null)
    startTransition(async () => {
      const res = await syncTrackingNumbersFromEightHundred({
        brandSlug: "si-se-pierde",
        dryRun,
      })
      setResult(res)
    })
  }

  return (
    <div className="space-y-3 pt-4 border-t border-gray-200">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">
          Sincronizar tracking numbers desde 800.com
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Trae la lista completa de numbers de la company 800.com y los
          inserta en <code>tracking_numbers</code> (brand: Si Se Pierde)
          si no existen. Sin esto, las llamadas a numbers no registrados
          se descartan en el webhook receiver. Después correr el backfill
          para recuperar las llamadas históricas.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={isPending}
            className="w-3.5 h-3.5"
          />
          <span className="text-xs text-gray-700">
            Modo prueba (solo mostrar, NO registrar todavía)
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
          {isPending ? (
            "Procesando…"
          ) : (
            <span className="inline-flex items-center gap-1.5">
              {dryRun ? (
                <Eye className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              {dryRun
                ? "PASO 1A: Previsualizar numbers faltantes"
                : "PASO 1B: REGISTRAR numbers ahora (definitivo)"}
            </span>
          )}
        </button>
      </div>

      {result && result.ok && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs space-y-2">
          <p className="font-semibold text-emerald-900">
            ✓ {dryRun ? "Dry run completado" : "Sync completado"}
          </p>
          <ul className="text-emerald-800 list-disc list-inside space-y-1">
            <li>
              <strong>{result.total_in_800com}</strong> numbers totales en
              800.com
            </li>
            <li>
              <strong>{result.already_in_db.length}</strong> ya registrados
              en tracking_numbers
            </li>
            <li className={result.added.length > 0 ? "text-emerald-900 font-semibold" : ""}>
              <strong>{result.added.length}</strong>{" "}
              {dryRun ? "se agregarían" : "agregados ahora"} a brand Si Se Pierde
            </li>
            {result.errors.length > 0 && (
              <li className="text-amber-700">
                <strong>{result.errors.length}</strong> errores
              </li>
            )}
          </ul>

          {result.added.length > 0 && (
            <details className="pt-1">
              <summary className="cursor-pointer text-emerald-900 font-medium text-xs">
                Ver detalle de los {result.added.length}{" "}
                {dryRun ? "que se agregarían" : "agregados"}
              </summary>
              <pre className="mt-1 p-2 bg-white border border-emerald-200 rounded text-[10px] text-emerald-900 overflow-x-auto max-h-48">
                {result.added
                  .map((n) => `#${n.id} · ${n.number} · ${n.label ?? "(sin label)"}`)
                  .join("\n")}
              </pre>
            </details>
          )}

          {result.errors.length > 0 && (
            <details className="pt-1">
              <summary className="cursor-pointer text-amber-800 font-medium text-xs">
                Ver errores
              </summary>
              <pre className="mt-1 p-2 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-900 overflow-x-auto max-h-32">
                {result.errors.join("\n")}
              </pre>
            </details>
          )}

          {dryRun && result.added.length > 0 && (
            <p className="text-emerald-900 font-medium text-xs pt-1 flex items-start gap-1.5">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Si esto está bien, destildá &quot;Dry run&quot; y click
                &quot;Sincronizar ahora&quot; para insertar.
              </span>
            </p>
          )}

          {!dryRun && result.added.length > 0 && (
            <p className="text-emerald-900 font-medium text-xs pt-1 flex items-start gap-1.5">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Próximo paso: arriba en &quot;Backfill calls&quot;, corré
                backfill desde hace 30 días para traer las llamadas históricas
                de los numbers nuevos.
              </span>
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
