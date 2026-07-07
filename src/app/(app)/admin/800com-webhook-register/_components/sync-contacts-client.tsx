"use client"

import { useState, useTransition } from "react"
import { Eye, CheckCircle2, ArrowRight, AlertTriangle } from "lucide-react"
import {
  syncContactsFromConversations,
  type SyncContactsResult,
} from "../backfill-actions"

/**
 * UI para extraer TODA la info de cada cliente de 800.com (nombre, teléfono,
 * dirección, email, carrier) desde las conversations / enhancedCallerId.
 *
 * A diferencia del backfill de calls huérfanas, este recorre CONTACTOS:
 * crea leads nuevos Y rellena los leads viejos que ya tenían nombre pero
 * les faltaba dirección/email.
 *
 * Safe: en leads existentes solo llena campos vacíos (no pisa data buena).
 */
export function SyncContactsClient() {
  const [dryRun, setDryRun] = useState(true)
  const [useEcid, setUseEcid] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<SyncContactsResult | null>(null)

  function handleRun() {
    setResult(null)
    startTransition(async () => {
      const res = await syncContactsFromConversations({ dryRun, useEcid })
      setResult(res)
    })
  }

  return (
    <div className="space-y-3 pt-4 border-t border-gray-200">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">
          Extraer contactos completos de 800.com (nombre + dirección + email)
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Recorre TODAS las conversations de 800.com y, por cada cliente, crea
          el lead o rellena los campos que le falten: nombre, teléfono,
          dirección, ciudad, estado, ZIP, email y carrier. Llena leads viejos
          que solo tenían nombre. Solo completa campos vacíos — nunca pisa data
          existente.
        </p>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 cursor-pointer h-9">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={isPending}
            className="w-3.5 h-3.5"
          />
          <span className="text-xs text-gray-700">
            Modo prueba (solo contar, NO escribir todavía)
          </span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer h-9">
          <input
            type="checkbox"
            checked={useEcid}
            onChange={(e) => setUseEcid(e.target.checked)}
            disabled={isPending}
            className="w-3.5 h-3.5"
          />
          <span className="text-xs text-gray-700">
            Completar dirección/email con ECID (cacheado = gratis)
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
            "Procesando… (puede tardar)"
          ) : (
            <span className="inline-flex items-center gap-1.5">
              {dryRun ? (
                <Eye className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              {dryRun
                ? "Previsualizar extracción"
                : "Extraer y guardar contactos (definitivo)"}
            </span>
          )}
        </button>
      </div>

      {result && result.ok && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs space-y-2">
          <p className="font-semibold text-emerald-900">
            ✓ {result.dry_run ? "Dry run completado" : "Extracción completada"}
          </p>
          <ul className="text-emerald-800 list-disc list-inside space-y-1">
            <li><strong>{result.conversations_seen}</strong> conversations / contactos recorridos</li>
            <li><strong>{result.leads_created}</strong> leads {result.dry_run ? "se crearían" : "creados"}</li>
            <li><strong>{result.leads_updated}</strong> leads existentes {result.dry_run ? "se rellenarían" : "rellenados"}</li>
            <li><strong>{result.with_address}</strong> contactos con dirección disponible</li>
            <li><strong>{result.with_email}</strong> contactos con email disponible</li>
            <li>
              <strong>{result.ecid_lookups}</strong> lookups ECID ·{" "}
              <span className={result.ecid_charged > 0 ? "text-amber-700 font-medium" : "text-emerald-700"}>
                {result.ecid_charged} cobrados
              </span>{" "}
              ({result.ecid_lookups - result.ecid_charged} cacheados/gratis)
            </li>
            <li className="text-amber-700"><strong>{result.skipped_no_brand}</strong> sin brand (número no registrado) · <strong>{result.skipped_no_phone}</strong> sin teléfono</li>
          </ul>

          {result.sample.length > 0 && (
            <details className="pt-1">
              <summary className="cursor-pointer text-emerald-900 font-medium text-xs">
                Ver muestra (primeros 15)
              </summary>
              <pre className="mt-1 p-2 bg-white border border-emerald-200 rounded text-[10px] text-emerald-900 overflow-x-auto max-h-60">
                {result.sample
                  .map((l) => `${l.name} · ${l.phone}${l.address ? ` · ${l.address}` : ""}${l.email ? ` · ${l.email}` : ""}`)
                  .join("\n")}
              </pre>
            </details>
          )}

          {result.dry_run && (result.leads_created > 0 || result.leads_updated > 0) && (
            <p className="text-emerald-900 font-medium text-xs pt-1 flex items-start gap-1.5">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Si se ve bien, destildá &quot;Modo prueba&quot; y volvé a correr para guardar.</span>
            </p>
          )}

          {result.ecid_charged > 0 && (
            <p className="text-amber-700 font-medium text-xs pt-1 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                {result.ecid_charged} lookups ECID NO estaban cacheados y se
                cobraron. El resto fue gratis. Si querés cero costo, destildá
                &quot;Completar con ECID&quot; (traés solo lo que viene en conversations).
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
