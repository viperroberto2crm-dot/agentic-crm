"use client"

import { Fragment, useState, useTransition } from "react"
import { Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { fetchWebhookHistory, fetchWebhookHistoryDetail, WebhookHistoryItem } from "../webhook-history"

type HistoryResult = Awaited<ReturnType<typeof fetchWebhookHistory>>
type DetailResult = Awaited<ReturnType<typeof fetchWebhookHistoryDetail>>

export function WebhookHistoryViewer({
  webhookIds,
  loadHistory,
  loadDetail,
}: {
  webhookIds: number[]
  loadHistory: (id: number) => Promise<HistoryResult>
  loadDetail: (webhookId: number, historyId: number) => Promise<DetailResult>
}) {
  const [selectedWebhook, setSelectedWebhook] = useState<number | null>(
    webhookIds[0] ?? null,
  )
  const [items, setItems] = useState<WebhookHistoryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [expandedId, setExpandedId] = useState<number | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [detail, setDetail] = useState<Record<number, any>>({})
  const [detailLoading, setDetailLoading] = useState<number | null>(null)

  function handleLoad() {
    if (!selectedWebhook) return
    setError(null)
    startTransition(async () => {
      const res = await loadHistory(selectedWebhook)
      if (!res.ok) {
        setError(res.error)
        setItems(null)
        return
      }
      setItems(res.items)
    })
  }

  async function handleExpand(item: WebhookHistoryItem) {
    if (!selectedWebhook) return
    if (expandedId === item.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(item.id)
    if (detail[item.id]) return
    setDetailLoading(item.id)
    const res = await loadDetail(selectedWebhook, item.id)
    setDetailLoading(null)
    if (res.ok) {
      setDetail((prev) => ({ ...prev, [item.id]: res.detail }))
    } else {
      setDetail((prev) => ({ ...prev, [item.id]: { error: res.error } }))
    }
  }

  if (webhookIds.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded p-4">
        <p className="text-sm text-gray-500">
          Registra un webhook arriba para poder ver su history de delivery.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-center flex-wrap">
        {webhookIds.length > 1 && (
          <select
            value={selectedWebhook ?? ""}
            onChange={(e) => setSelectedWebhook(Number(e.target.value))}
            className="text-xs border border-gray-200 rounded px-2 py-1"
          >
            {webhookIds.map((id) => (
              <option key={id} value={id}>
                Webhook #{id}
              </option>
            ))}
          </select>
        )}
        <Button
          onClick={handleLoad}
          disabled={isPending || !selectedWebhook}
          className="cursor-pointer"
          size="sm"
          variant="outline"
        >
          {isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              Cargando…
            </>
          ) : (
            <>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Cargar history del webhook #{selectedWebhook}
            </>
          )}
        </Button>
        <p className="text-[11px] text-gray-500">
          Muestra los últimos eventos que 800.com intentó entregar.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {items && items.length === 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
          ⚠️ El history está vacío. 800.com no ha intentado entregar ningún evento
          a este webhook desde que fue registrado. Posibles causas: el número marcado
          no está bajo la company id correcta, o el webhook fue registrado después
          de las llamadas.
        </div>
      )}

      {items && items.length > 0 && (
        <div className="bg-white border border-gray-200 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-gray-500 w-8"></th>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">Time</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">Feature</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">Method</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">Response</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">URL</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const code = item.httpResponseCode ?? 0
                const ok = code >= 200 && code < 300
                const isOpen = expandedId === item.id
                return (
                  <Fragment key={item.id}>
                    <tr
                      onClick={() => handleExpand(item)}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-3 py-2">
                        {isOpen ? (
                          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-600">
                        {new Date(item.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-medium">
                          {item.feature}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono">{item.method}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                            ok
                              ? "bg-emerald-50 text-emerald-700"
                              : code === 0
                                ? "bg-gray-100 text-gray-500"
                                : "bg-red-50 text-red-700"
                          }`}
                        >
                          {code || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono break-all text-gray-600 max-w-md">
                        {item.url}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <td colSpan={6} className="px-3 py-3">
                          {detailLoading === item.id ? (
                            <p className="text-xs text-gray-500">
                              <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
                              Cargando detalle…
                            </p>
                          ) : detail[item.id] ? (
                            <pre className="text-[10px] bg-white p-2 rounded border border-gray-200 overflow-x-auto max-h-96">
                              {JSON.stringify(detail[item.id], null, 2)}
                            </pre>
                          ) : (
                            <p className="text-xs text-gray-400">Click para cargar</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
