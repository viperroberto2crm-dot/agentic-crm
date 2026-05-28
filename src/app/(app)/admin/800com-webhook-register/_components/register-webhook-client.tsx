"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { WebhookItem, registerWebhook, deleteWebhook } from "../actions"

type RegisterResult = Awaited<ReturnType<typeof registerWebhook>>
type DeleteResult = Awaited<ReturnType<typeof deleteWebhook>>

type ListResult =
  | { ok: true; webhooks: WebhookItem[] }
  | { ok: false; error: string }

export function RegisterWebhookClient({
  initialResult,
  canRegister,
  registerAction,
  deleteAction,
}: {
  initialResult: ListResult
  canRegister: boolean
  registerAction: () => Promise<RegisterResult>
  deleteAction: (id: number) => Promise<DeleteResult>
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [list, setList] = useState<ListResult>(initialResult)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  function handleRegister() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const res = await registerAction()
      if (!res.ok) {
        setError(res.error)
        return
      }
      setSuccess(`Webhook registrado (id: ${res.webhook.id})`)
      router.refresh()
    })
  }

  function handleDelete(id: number) {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const res = await deleteAction(id)
      if (!res.ok) {
        setError(res.error)
        setConfirmDeleteId(null)
        return
      }
      setSuccess(`Webhook ${id} eliminado`)
      setConfirmDeleteId(null)
      // Reflect locally
      if (list.ok) {
        setList({ ok: true, webhooks: list.webhooks.filter((w) => w.id !== id) })
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <Button
          onClick={handleRegister}
          disabled={!canRegister || isPending}
          className="cursor-pointer"
          style={{ background: "var(--brand)" }}
        >
          {isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              Procesando…
            </>
          ) : (
            "Register webhook"
          )}
        </Button>
        {!canRegister && (
          <span className="text-xs text-amber-700">
            Configura primero EIGHTHUNDRED_WEBHOOK_SECRET en Vercel y redeploy.
          </span>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-700">
          {success}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded">
        <div className="px-3 py-2 border-b border-gray-100">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Webhooks registrados en 800.com
          </p>
        </div>
        {!list.ok ? (
          <div className="p-4 text-sm text-red-600">
            Error listando: {list.error}
          </div>
        ) : list.webhooks.length === 0 ? (
          <div className="p-4 text-sm text-gray-400">
            Sin webhooks. Click &quot;Register webhook&quot; arriba.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">ID</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">Method</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">URL</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">Features</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-500">Acción</th>
              </tr>
            </thead>
            <tbody>
              {list.webhooks.map((w) => (
                <tr key={w.id} className="border-b border-gray-100">
                  <td className="px-3 py-2 font-mono">{w.id}</td>
                  <td className="px-3 py-2">{w.method}</td>
                  <td className="px-3 py-2 font-mono break-all max-w-md">{w.url}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {w.features.map((f) => (
                        <span
                          key={f}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {confirmDeleteId === w.id ? (
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDelete(w.id)}
                          disabled={isPending}
                          className="text-[10px] px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 cursor-pointer"
                        >
                          Sí, borrar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={isPending}
                          className="text-[10px] px-2 py-1 rounded text-gray-500 hover:bg-gray-100 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(w.id)}
                        disabled={isPending}
                        className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                        title="Eliminar webhook"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
