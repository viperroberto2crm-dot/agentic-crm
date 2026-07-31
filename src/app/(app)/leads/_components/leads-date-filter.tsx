"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  formatYmdForDisplay,
  getPresetRange,
  type DateRangePreset,
} from "@/lib/dashboard/date-ranges"
import { RangeCalendar } from "@/app/(app)/dashboard/_components/date-range-filter"

type Props = {
  /** true si hay un filtro de fecha activo en la URL. */
  active: boolean
  preset: DateRangePreset
  from: string
  to: string
  timezone: string
}

// Solo presets PASADOS: los pacientes ya entraron (no tiene sentido "próximos 7").
const PAST_PRESETS: ReadonlyArray<Exclude<DateRangePreset, "custom">> = [
  "today",
  "last7",
  "last30",
  "thisWeek",
  "thisMonth",
  "lastMonth",
]

export function LeadsDateFilter({ active, preset, from, to, timezone }: Props) {
  const t = useTranslations("leads")
  const tf = useTranslations("dashboard.filters")
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [open, setOpen] = useState(false)
  const [showCustom, setShowCustom] = useState(active && preset === "custom")
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (rootRef.current && target && !rootRef.current.contains(target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  useEffect(() => {
    setShowCustom(active && preset === "custom")
  }, [active, preset])

  // Muta from/to/preset en la URL (y borra offset para volver a la 1a página).
  const setParams = useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString())
      mut(next)
      next.delete("offset")
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const applyPreset = useCallback(
    (p: Exclude<DateRangePreset, "custom">) => {
      const r = getPresetRange(p, timezone)
      setParams((next) => {
        next.set("from", r.from)
        next.set("to", r.to)
        next.set("preset", p)
      })
      setShowCustom(false)
      setOpen(false)
    },
    [setParams, timezone],
  )

  const clearDate = useCallback(() => {
    setParams((next) => {
      next.delete("from")
      next.delete("to")
      next.delete("preset")
    })
    setShowCustom(false)
    setOpen(false)
  }, [setParams])

  const applyCustom = useCallback(
    (f: string, tt: string) => {
      setParams((next) => {
        next.set("from", f)
        next.set("to", tt)
        next.set("preset", "custom")
      })
      setOpen(false)
    },
    [setParams],
  )

  const triggerLabel = useMemo(() => {
    if (!active) return t("dateFilterCta")
    if (preset !== "custom") return tf(preset)
    if (from === to) return formatYmdForDisplay(from, locale)
    return `${formatYmdForDisplay(from, locale)} – ${formatYmdForDisplay(to, locale)}`
  }, [active, preset, from, to, locale, t, tf])

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-2 h-9 px-3.5 rounded-full border text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap shadow-[0_1px_2px_rgba(26,46,40,0.05)]",
          active
            ? "bg-[#20342C] text-white border-[#20342C]"
            : "bg-card text-[#5C6F68] border-[#ECE3D3] hover:border-[#D8CDB5] hover:text-[#20342C]",
        )}
      >
        <CalendarIcon className={cn("w-3.5 h-3.5", active ? "text-white/80" : "text-[#93A39D]")} />
        <span className="tabular-nums">{triggerLabel}</span>
        <ChevronDown className={cn("w-3.5 h-3.5", active ? "text-white/80" : "text-[#93A39D]")} />
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute left-0 z-50 mt-2 rounded-xl border border-[#ECE3D3] bg-white shadow-lg p-2 flex"
          style={{ minWidth: showCustom ? "min(560px, 90vw)" : "210px" }}
        >
          <ul className="flex flex-col w-48 shrink-0">
            <li>
              <button
                type="button"
                onClick={clearDate}
                className={cn(
                  "w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors",
                  !active
                    ? "bg-[#F3EFE6] text-[#20342C] font-medium"
                    : "text-gray-700 hover:bg-gray-50",
                )}
              >
                {t("allDates")}
              </button>
            </li>
            {PAST_PRESETS.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors",
                    active && preset === p
                      ? "bg-[#F3EFE6] text-[#20342C] font-medium"
                      : "text-gray-700 hover:bg-gray-50",
                  )}
                >
                  {tf(p)}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => setShowCustom(true)}
                className={cn(
                  "w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors",
                  showCustom
                    ? "bg-[#F3EFE6] text-[#20342C] font-medium"
                    : "text-gray-700 hover:bg-gray-50",
                )}
              >
                {tf("custom")}
              </button>
            </li>
          </ul>

          {showCustom && (
            <div className="ml-2 pl-2 border-l border-gray-100">
              <RangeCalendar
                initialFrom={active ? from : ""}
                initialTo={active ? to : ""}
                timezone={timezone}
                locale={locale}
                onApply={applyCustom}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
