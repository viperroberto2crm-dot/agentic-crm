"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useCallback, useTransition } from "react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Search, X } from "lucide-react"
import type { Database } from "@/types/database"

type LeadStatus = Database["public"]["Enums"]["lead_status"]
type LeadSource = Database["public"]["Enums"]["lead_source"]

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "Nuevo",
  contacted: "Contactado",
  qualified: "Calificado",
  appointment_set: "Cita agendada",
  sold: "Vendido",
  lost: "Perdido",
  on_hold: "En pausa",
}

const SOURCE_LABELS: Record<LeadSource, string> = {
  inbound_call: "Llamada entrante",
  web_form: "Formulario web",
  referral: "Referido",
  whatsapp: "WhatsApp",
  walk_in: "Walk-in",
  social: "Redes sociales",
  other: "Otro",
}

export function LeadFilterBar({
  total,
  showRepFilter,
}: {
  total: number
  showRepFilter?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const update = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString())
      if (value && value !== "all") {
        next.set(key, value)
      } else {
        next.delete(key)
      }
      next.delete("offset") // reset pagination on filter change
      startTransition(() => {
        router.replace(`${pathname}?${next.toString()}`)
      })
    },
    [params, pathname, router]
  )

  const search = params.get("search") ?? ""
  const status = params.get("status") ?? "all"
  const source = params.get("source") ?? "all"
  const hasFilters = search || status !== "all" || source !== "all"

  return (
    <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
      {/* Search */}
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
        <Input
          type="text"
          placeholder="Nombre, teléfono, email…"
          defaultValue={search}
          className="pl-8 h-9 bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600 text-sm focus-visible:ring-zinc-700"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const v = e.target.value
            if (v.length === 0 || v.length >= 2) update("search", v || null)
          }}
        />
      </div>

      {/* Status filter */}
      <Select value={status} onValueChange={(v: string) => update("status", v)}>
        <SelectTrigger className="h-9 w-[160px] bg-zinc-900 border-zinc-800 text-zinc-300 text-sm">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-900 border-zinc-800">
          <SelectItem value="all" className="text-zinc-400 text-sm">Todos los status</SelectItem>
          {(Object.entries(STATUS_LABELS) as [LeadStatus, string][]).map(([v, label]) => (
            <SelectItem key={v} value={v} className="text-zinc-200 text-sm">{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Source filter */}
      <Select value={source} onValueChange={(v: string) => update("source", v)}>
        <SelectTrigger className="h-9 w-[160px] bg-zinc-900 border-zinc-800 text-zinc-300 text-sm">
          <SelectValue placeholder="Fuente" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-900 border-zinc-800">
          <SelectItem value="all" className="text-zinc-400 text-sm">Todas las fuentes</SelectItem>
          {(Object.entries(SOURCE_LABELS) as [LeadSource, string][]).map(([v, label]) => (
            <SelectItem key={v} value={v} className="text-zinc-200 text-sm">{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Clear filters */}
      {hasFilters && (
        <button
          onClick={() => {
            startTransition(() => router.replace(pathname))
          }}
          className="flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-400 transition-colors px-1 whitespace-nowrap"
        >
          <X className="w-3 h-3" />
          Limpiar
        </button>
      )}

      {/* Count + pending indicator */}
      <span className={`text-xs whitespace-nowrap ${isPending ? "text-zinc-600" : "text-zinc-500"} ml-auto pl-2`}>
        {isPending ? "…" : `${total} lead${total !== 1 ? "s" : ""}`}
      </span>
    </div>
  )
}
