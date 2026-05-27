"use client"

import { useState, useTransition } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { runEcidBackfill, type BackfillSummary, type BackfillItem } from "../actions"

const BATCH_SIZE = 100 // Vercel function timeout es 300s, 100*1.2s = 120s → bajo el límite

export function BackfillClient({
  brandId,
  maxCandidates,
}: {
  brandId: string | null
  maxCandidates: number
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<BackfillSummary | null>(null)
  const [confirmingReal, setConfirmingReal] = useState(false)

  function handleRun(dryRun: boolean) {
    setError(null)
    if (!dryRun) {
      // Una capa extra de "are you sure"
      if (!confirmingReal) {
        setConfirmingReal(true)
        return
      }
    }
    startTransition(async () => {
      try {
        const res = await runEcidBackfill({
          dryRun,
          limit: BATCH_SIZE,
          brandId,
        })
        setSummary(res)
        setConfirmingReal(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-center">
        <Button
          onClick={() => handleRun(true)}
          disabled={isPending || maxCandidates === 0}
          variant="outline"
          className="cursor-pointer"
        >
          {isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              Procesando…
            </>
          ) : (
            <>Dry run (sin guardar) — {Math.min(maxCandidates, BATCH_SIZE)} leads</>
          )}
        </Button>

        {!confirmingReal ? (
          <Button
            onClick={() => handleRun(false)}
            disabled={isPending || maxCandidates === 0}
            className="cursor-pointer"
            style={{ background: "var(--brand)" }}
          >
            Run backfill REAL — {Math.min(maxCandidates, BATCH_SIZE)} leads
          </Button>
        ) : (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded px-3 py-1.5">
            <span className="text-xs text-red-700">¿Seguro? Guardará en DB.</span>
            <Button
              size="sm"
              onClick={() => handleRun(false)}
              disabled={isPending}
              className="cursor-pointer bg-red-600 hover:bg-red-700 text-white h-7"
            >
              {isPending ? "Procesando…" : "Sí, ejecutar"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmingReal(false)}
              disabled={isPending}
              className="cursor-pointer h-7"
            >
              Cancelar
            </Button>
          </div>
        )}

        {summary && (
          <span className="text-xs text-gray-500">
            Última corrida: {summary.dryRun ? "DRY RUN" : "REAL"} ·{" "}
            {summary.processed} procesados
          </span>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {isPending && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
          Procesando hasta {BATCH_SIZE} leads. Cada uno tarda ~1.2s. Espera unos minutos…
        </div>
      )}

      {summary && <SummaryView summary={summary} />}
    </div>
  )
}

function SummaryView({ summary }: { summary: BackfillSummary }) {
  return (
    <div className="space-y-3">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Procesados" value={summary.processed} />
        <Stat label="Encontrados (found)" value={summary.found} className="text-emerald-600" />
        <Stat label="Not found" value={summary.not_found} className="text-amber-600" />
        <Stat
          label={summary.dryRun ? "Se actualizarían" : "Actualizados"}
          value={summary.dryRun ? summary.items.filter((i) => i.action === "would_update").length : summary.updated}
          className="text-blue-600"
        />
        <Stat label="Sin cambios" value={summary.skipped_no_changes} />
        <Stat label="Errores" value={summary.errors} className={summary.errors > 0 ? "text-red-600" : ""} />
        <Stat label="Cache hits ($0)" value={summary.cache_hits} className="text-emerald-600" />
        <Stat label="Live lookups ($$)" value={summary.live_lookups} className="text-amber-600" />
      </div>

      {/* Items table */}
      <div className="bg-white border border-gray-200 rounded">
        <div className="px-3 py-2 border-b border-gray-100">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Detalle ({summary.items.length})
          </p>
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">Teléfono</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">Lead actual</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">Match</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">Cambios propuestos</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">Acción</th>
              </tr>
            </thead>
            <tbody>
              {summary.items.map((it) => (
                <Row key={it.lead_id} item={it} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded p-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{label}</p>
      <p className={`text-lg font-semibold ${className || "text-gray-900"}`}>{value}</p>
    </div>
  )
}

function Row({ item }: { item: BackfillItem }) {
  const actionColors: Record<BackfillItem["action"], string> = {
    would_update: "bg-blue-100 text-blue-700",
    updated: "bg-emerald-100 text-emerald-700",
    skip_no_data: "bg-gray-100 text-gray-500",
    skip_no_changes: "bg-yellow-100 text-yellow-700",
    error: "bg-red-100 text-red-700",
  }
  const actionLabels: Record<BackfillItem["action"], string> = {
    would_update: "Se actualizaría",
    updated: "Actualizado ✓",
    skip_no_data: "Sin datos en 800",
    skip_no_changes: "Ya completo",
    error: "Error",
  }

  return (
    <tr className="border-b border-gray-100">
      <td className="px-3 py-2 font-mono text-gray-700">{item.phone}</td>
      <td className="px-3 py-2 text-gray-600">{item.current_name}</td>
      <td className="px-3 py-2">
        <span
          className={
            item.matchStatus === "found"
              ? "text-emerald-600"
              : item.matchStatus === "not_found"
                ? "text-amber-600"
                : "text-red-600"
          }
        >
          {item.matchStatus}
        </span>
        {item.cacheHit && <span className="ml-1 text-[10px] text-gray-400">(cache)</span>}
      </td>
      <td className="px-3 py-2 text-gray-700">
        {Object.keys(item.proposed).length === 0 ? (
          <span className="text-gray-300">—</span>
        ) : (
          <div className="space-y-0.5">
            {Object.entries(item.proposed).map(([k, v]) => (
              <div key={k} className="font-mono text-[11px]">
                <span className="text-gray-400">{k}:</span> {String(v)}
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${actionColors[item.action]}`}>
          {actionLabels[item.action]}
        </span>
        {item.error && <p className="text-[10px] text-red-600 mt-0.5">{item.error}</p>}
      </td>
    </tr>
  )
}
