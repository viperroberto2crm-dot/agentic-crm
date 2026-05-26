"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, Check, Loader2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { reassignAppointmentProvider } from "../actions"

export type ProviderOption = { id: string; name: string }

export function ProviderCellSelectClient({
  appointmentId,
  currentProviderId,
  currentProviderName,
  providers,
  canEdit,
}: {
  appointmentId: string
  currentProviderId: string | null
  currentProviderName: string | null
  providers: ProviderOption[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!canEdit) {
    return <span className="text-xs text-gray-400">{currentProviderName ?? "—"}</span>
  }

  function handleSelect(newId: string | null) {
    if (newId === currentProviderId) return
    setError(null)
    startTransition(async () => {
      const res = await reassignAppointmentProvider(appointmentId, newId)
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
          <span>{currentProviderName ?? "Sin provider"}</span>
          {isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <ChevronDown className="w-3 h-3 opacity-50" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 bg-white border-gray-200 max-h-60 overflow-y-auto">
        <DropdownMenuItem
          onClick={() => handleSelect(null)}
          disabled={isPending}
          className={`text-xs cursor-pointer flex items-center justify-between gap-2 italic ${
            currentProviderId === null ? "text-gray-900 font-medium" : "text-gray-500"
          }`}
        >
          <span>Sin provider</span>
          {currentProviderId === null && <Check className="w-3 h-3 text-emerald-500 shrink-0" />}
        </DropdownMenuItem>
        {providers.length > 0 && <DropdownMenuSeparator />}
        {providers.length === 0 ? (
          <p className="text-xs text-gray-400 px-2 py-1.5">Sin providers disponibles</p>
        ) : (
          providers.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => handleSelect(p.id)}
              disabled={isPending}
              className={`text-xs cursor-pointer flex items-center justify-between gap-2 ${
                p.id === currentProviderId ? "text-gray-900 font-medium" : "text-gray-700"
              }`}
            >
              <span className="truncate">{p.name}</span>
              {p.id === currentProviderId && <Check className="w-3 h-3 text-emerald-500 shrink-0" />}
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
