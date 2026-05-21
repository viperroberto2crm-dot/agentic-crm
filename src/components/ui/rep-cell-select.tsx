"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, Check, Loader2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type RepOption = { id: string; name: string; role?: string }

/**
 * Celda inline para reasignar el rep de una venta/cita.
 * Si el user no es admin/manager, renderiza solo el texto sin permitir cambio.
 */
export function RepCellSelect({
  currentRepId,
  currentRepName,
  reps,
  canEdit,
  onReassign,
}: {
  currentRepId: string | null
  currentRepName: string | null
  reps: RepOption[]
  canEdit: boolean
  onReassign: (newRepId: string) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!canEdit) {
    return <span className="text-xs text-gray-400">{currentRepName ?? "—"}</span>
  }

  function handleSelect(newId: string) {
    if (newId === currentRepId) return
    setError(null)
    startTransition(async () => {
      const res = await onReassign(newId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded px-1.5 py-0.5 transition-colors cursor-pointer"
          disabled={isPending}
        >
          <span>{currentRepName ?? "Sin asignar"}</span>
          {isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <ChevronDown className="w-3 h-3 opacity-50" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 bg-white border-gray-200 max-h-60 overflow-y-auto">
        {reps.length === 0 ? (
          <p className="text-xs text-gray-400 px-2 py-1.5">Sin reps disponibles</p>
        ) : (
          reps.map((r) => (
            <DropdownMenuItem
              key={r.id}
              onClick={() => handleSelect(r.id)}
              disabled={isPending}
              className={`text-xs cursor-pointer flex items-center justify-between gap-2 ${
                r.id === currentRepId ? "text-gray-900 font-medium" : "text-gray-700"
              }`}
            >
              <span className="truncate flex items-center gap-1.5">
                {r.name}
                {r.role === "provider" && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-violet-100 text-violet-700 font-medium uppercase tracking-wider">
                    Prov
                  </span>
                )}
              </span>
              {r.id === currentRepId && <Check className="w-3 h-3 text-emerald-500 shrink-0" />}
            </DropdownMenuItem>
          ))
        )}
        {error && (
          <p className="text-[10px] text-red-500 px-2 py-1 border-t border-gray-100 mt-1">{error}</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
