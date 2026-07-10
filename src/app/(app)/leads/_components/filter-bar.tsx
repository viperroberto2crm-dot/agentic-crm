"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useTranslations } from "next-intl"
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

type LeadSource = Database["public"]["Enums"]["lead_source"]

export function LeadFilterBar({
  total,
  showRepFilter,
}: {
  total: number
  showRepFilter?: boolean
}) {
  const t = useTranslations("leads")
  const ts = useTranslations("status")
  const tsrc = useTranslations("source")

  // Píldoras segmentadas (los estados más usados). Cada una setea el mismo
  // parámetro ?status= que antes usaba el dropdown.
  const STATUS_PILLS: { value: string; label: string }[] = [
    { value: "all", label: t("allStatus") },
    { value: "new", label: ts("new") },
    { value: "contacted", label: ts("contacted") },
    { value: "appointment_set", label: ts("appointment_set") },
    { value: "sold", label: ts("sold") },
  ]

  const SOURCE_LABELS: Record<LeadSource, string> = {
    inbound_call: tsrc("inbound_call"),
    web_form: tsrc("web_form"),
    referral: tsrc("referral"),
    whatsapp: tsrc("whatsapp"),
    walk_in: tsrc("walk_in"),
    social: tsrc("social"),
    facebook: tsrc("facebook"),
    other: tsrc("other"),
  }

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
      next.delete("offset")
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

  // Input controlado con debounce 400ms + ref para evitar race con sync de URL.
  // Sin esto, cada keystroke triggea router.replace inmediato (sin debounce) y
  // el input no controlado pierde teclas cuando el usuario escribe rápido.
  const [searchInput, setSearchInput] = useState(search)
  const lastSetByUs = useRef(search)

  useEffect(() => {
    if (search === lastSetByUs.current) return
    setSearchInput(search)
  }, [search])

  useEffect(() => {
    const handler = setTimeout(() => {
      const trimmed = searchInput.trim()
      if (trimmed === lastSetByUs.current) return
      lastSetByUs.current = trimmed
      update("search", trimmed || null)
    }, 400)
    return () => clearTimeout(handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  return (
    <div className="flex flex-col gap-3">
      {/* Píldoras segmentadas de estado */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_PILLS.map((p) => {
          const active = status === p.value
          return (
            <button
              key={p.value}
              onClick={() => update("status", p.value === "all" ? null : p.value)}
              className={
                "h-8 px-3.5 rounded-full text-[13px] font-medium border transition-colors cursor-pointer whitespace-nowrap " +
                (active
                  ? "bg-[#20342C] text-white border-[#20342C]"
                  : "bg-card text-[#5C6F68] border-[#ECE3D3] hover:border-[#D8CDB5] hover:text-[#20342C]")
              }
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* Buscador + origen + conteo */}
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-2.5 w-3.5 h-3.5 text-[#93A39D] pointer-events-none" />
          <Input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={searchInput}
            className="pl-9 h-9 rounded-full bg-card border-[#ECE3D3] text-[#20342C] placeholder:text-[#93A39D] text-sm shadow-[0_1px_2px_rgba(26,46,40,0.05)] focus-visible:ring-[#12483B]/25"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchInput(e.target.value)}
          />
        </div>

        <Select value={source} onValueChange={(v: string) => update("source", v)}>
          <SelectTrigger className="h-9 w-[150px] rounded-full bg-card border-[#ECE3D3] text-[#5C6F68] text-sm shadow-[0_1px_2px_rgba(26,46,40,0.05)]">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent className="bg-white border-gray-200">
            <SelectItem value="all" className="text-gray-500 text-sm">{t("allSources")}</SelectItem>
            {(Object.entries(SOURCE_LABELS) as [LeadSource, string][]).map(([v, label]) => (
              <SelectItem key={v} value={v} className="text-gray-800 text-sm">{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <button
            onClick={() => {
              startTransition(() => router.replace(pathname))
            }}
            className="flex items-center gap-1 text-xs text-[#93A39D] hover:text-[#5C6F68] transition-colors px-1 whitespace-nowrap"
          >
            <X className="w-3 h-3" />
            {t("clearFilters")}
          </button>
        )}

        <span className="text-xs text-[#93A39D] whitespace-nowrap ml-auto pl-2 tabular-nums">
          {isPending ? "…" : `${total} lead${total !== 1 ? "s" : ""}`}
        </span>
      </div>
    </div>
  )
}
