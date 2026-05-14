"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useCallback, useTransition } from "react"
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

type LeadStatus = Database["public"]["Enums"]["lead_status"]
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

  const STATUS_LABELS: Record<LeadStatus, string> = {
    new: ts("new"),
    contacted: ts("contacted"),
    qualified: ts("qualified"),
    appointment_set: ts("appointment_set"),
    sold: ts("sold"),
    lost: ts("lost"),
    on_hold: ts("on_hold"),
  }

  const SOURCE_LABELS: Record<LeadSource, string> = {
    inbound_call: tsrc("inbound_call"),
    web_form: tsrc("web_form"),
    referral: tsrc("referral"),
    whatsapp: tsrc("whatsapp"),
    walk_in: tsrc("walk_in"),
    social: tsrc("social"),
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

  return (
    <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        <Input
          type="text"
          placeholder={t("searchPlaceholder")}
          defaultValue={search}
          className="pl-8 h-9 bg-white border-gray-200 text-gray-800 placeholder:text-gray-400 text-sm focus-visible:ring-zinc-700"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const v = e.target.value
            if (v.length === 0 || v.length >= 2) update("search", v || null)
          }}
        />
      </div>

      <Select value={status} onValueChange={(v: string) => update("status", v)}>
        <SelectTrigger className="h-9 w-[160px] bg-white border-gray-200 text-gray-700 text-sm">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent className="bg-white border-gray-200">
          <SelectItem value="all" className="text-gray-500 text-sm">{t("allStatus")}</SelectItem>
          {(Object.entries(STATUS_LABELS) as [LeadStatus, string][]).map(([v, label]) => (
            <SelectItem key={v} value={v} className="text-gray-800 text-sm">{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={source} onValueChange={(v: string) => update("source", v)}>
        <SelectTrigger className="h-9 w-[160px] bg-white border-gray-200 text-gray-700 text-sm">
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
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-500 transition-colors px-1 whitespace-nowrap"
        >
          <X className="w-3 h-3" />
          {t("clearFilters")}
        </button>
      )}

      <span className={`text-xs whitespace-nowrap ${isPending ? "text-gray-400" : "text-gray-400"} ml-auto pl-2`}>
        {isPending ? "…" : `${total} lead${total !== 1 ? "s" : ""}`}
      </span>
    </div>
  )
}
