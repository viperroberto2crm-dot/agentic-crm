"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  formatYmd,
  formatYmdForDisplay,
  getPresetRange,
  isValidYmd,
  ymdFromDateInTz,
  ymdToParts,
  type DateRangePreset,
} from "@/lib/dashboard/date-ranges"

type Props = {
  /** Active preset (resolved server-side). */
  preset: DateRangePreset
  /** Active from (YYYY-MM-DD). */
  from: string
  /** Active to (YYYY-MM-DD). */
  to: string
  /** User's timezone (for "today" computation). */
  timezone: string
}

const NON_CUSTOM_PRESETS: ReadonlyArray<Exclude<DateRangePreset, "custom">> = [
  "today",
  "thisWeek",
  "thisMonth",
  "lastMonth",
  "thisQuarter",
  "thisYear",
]

export function DateRangeFilter({ preset, from, to, timezone }: Props) {
  const t = useTranslations("dashboard.filters")
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [open, setOpen] = useState(false)
  const [showCustom, setShowCustom] = useState(preset === "custom")
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false)
      }
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

  // Sync local "showCustom" when preset prop changes (e.g. via back/forward).
  useEffect(() => {
    setShowCustom(preset === "custom")
  }, [preset])

  const pushRange = useCallback(
    (fromYmd: string, toYmd: string, nextPreset: DateRangePreset) => {
      const next = new URLSearchParams(searchParams.toString())
      next.set("from", fromYmd)
      next.set("to", toYmd)
      next.set("preset", nextPreset)
      router.push(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const handlePresetClick = useCallback(
    (p: Exclude<DateRangePreset, "custom">) => {
      const r = getPresetRange(p, timezone)
      pushRange(r.from, r.to, p)
      setShowCustom(false)
      setOpen(false)
    },
    [pushRange, timezone]
  )

  const triggerLabel = useMemo(() => {
    if (preset !== "custom") return t(preset)
    return `${formatYmdForDisplay(from, locale)} – ${formatYmdForDisplay(to, locale)}`
  }, [preset, from, to, locale, t])

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors"
      >
        <CalendarIcon className="w-3.5 h-3.5 text-gray-400" />
        <span className="tabular-nums">{triggerLabel}</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute right-0 z-50 mt-2 rounded-md border border-gray-200 bg-white shadow-lg p-2 flex"
          style={{ minWidth: showCustom ? "min(560px, 90vw)" : "200px" }}
        >
          <ul className="flex flex-col w-44 shrink-0">
            {NON_CUSTOM_PRESETS.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => handlePresetClick(p)}
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded-sm text-sm transition-colors",
                    preset === p
                      ? "bg-gray-100 text-gray-900 font-medium"
                      : "text-gray-700 hover:bg-gray-50"
                  )}
                >
                  {t(p)}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => setShowCustom(true)}
                className={cn(
                  "w-full text-left px-2 py-1.5 rounded-sm text-sm transition-colors",
                  preset === "custom" || showCustom
                    ? "bg-gray-100 text-gray-900 font-medium"
                    : "text-gray-700 hover:bg-gray-50"
                )}
              >
                {t("custom")}
              </button>
            </li>
          </ul>

          {showCustom && (
            <div className="ml-2 pl-2 border-l border-gray-100">
              <RangeCalendar
                initialFrom={from}
                initialTo={to}
                timezone={timezone}
                locale={locale}
                onApply={(f, tt) => {
                  pushRange(f, tt, "custom")
                  setOpen(false)
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Range calendar (mode="range") ────────────────────────────────────────

type RangeCalendarProps = {
  initialFrom: string
  initialTo: string
  timezone: string
  locale: string
  onApply: (from: string, to: string) => void
}

function RangeCalendar({
  initialFrom,
  initialTo,
  timezone,
  locale,
  onApply,
}: RangeCalendarProps) {
  const tApply = useTranslations("dashboard.filters")

  // The visible month is taken from `initialFrom` (or today).
  const initialAnchor = useMemo(() => {
    const p = isValidYmd(initialFrom) ? ymdToParts(initialFrom) : null
    if (p) return { year: p.year, month: p.month }
    const todayYmd = ymdFromDateInTz(new Date(), timezone)
    const tp = ymdToParts(todayYmd)
    return tp
      ? { year: tp.year, month: tp.month }
      : { year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() + 1 }
  }, [initialFrom, timezone])

  const [view, setView] = useState<{ year: number; month: number }>(initialAnchor)
  const [pendingFrom, setPendingFrom] = useState<string | null>(
    isValidYmd(initialFrom) ? initialFrom : null
  )
  const [pendingTo, setPendingTo] = useState<string | null>(
    isValidYmd(initialTo) ? initialTo : null
  )
  const [hover, setHover] = useState<string | null>(null)

  const handleDayClick = useCallback(
    (ymd: string) => {
      // If no start, or both set, start a new selection.
      if (!pendingFrom || (pendingFrom && pendingTo)) {
        setPendingFrom(ymd)
        setPendingTo(null)
        return
      }
      // Selecting the end. Swap if user clicked an earlier date.
      if (ymd < pendingFrom) {
        setPendingTo(pendingFrom)
        setPendingFrom(ymd)
      } else {
        setPendingTo(ymd)
      }
    },
    [pendingFrom, pendingTo]
  )

  const monthLabel = useMemo(() => {
    const d = new Date(Date.UTC(view.year, view.month - 1, 1, 12, 0, 0))
    return new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    }).format(d)
  }, [view, locale])

  const weekdayLabels = useMemo(() => {
    // Build labels starting Monday using a known week.
    const base = new Date(Date.UTC(2024, 0, 1)) // 2024-01-01 is Monday.
    const fmt = new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      weekday: "short",
    })
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base.getTime() + i * 86_400_000)
      return fmt.format(d)
    })
  }, [locale])

  const cells = useMemo(() => buildMonthGrid(view.year, view.month), [view])

  const canApply = pendingFrom !== null && pendingTo !== null

  const inRange = useCallback(
    (ymd: string): boolean => {
      if (!pendingFrom) return false
      if (pendingTo) return ymd >= pendingFrom && ymd <= pendingTo
      if (hover && hover >= pendingFrom) return ymd >= pendingFrom && ymd <= hover
      return false
    },
    [pendingFrom, pendingTo, hover]
  )

  const isStart = (ymd: string): boolean => ymd === pendingFrom
  const isEnd = (ymd: string): boolean => ymd === pendingTo

  const todayYmd = useMemo(() => ymdFromDateInTz(new Date(), timezone), [timezone])

  const prevMonth = () => {
    const d = new Date(Date.UTC(view.year, view.month - 2, 1))
    setView({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 })
  }
  const nextMonth = () => {
    const d = new Date(Date.UTC(view.year, view.month, 1))
    setView({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 })
  }

  return (
    <div className="w-[320px] p-1">
      <div className="flex items-center justify-between mb-2 px-1">
        <button
          type="button"
          onClick={prevMonth}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-gray-800 capitalize">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-[10px] text-gray-400 uppercase tracking-wide mb-1 px-0.5">
        {weekdayLabels.map((w, i) => (
          <div key={i} className="h-6 flex items-center justify-center">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5 px-0.5">
        {cells.map((cell, idx) => {
          if (!cell) return <div key={`empty-${idx}`} className="h-8" />
          const ymd = cell.ymd
          const start = isStart(ymd)
          const end = isEnd(ymd)
          const between = !start && !end && inRange(ymd)
          const isToday = ymd === todayYmd
          return (
            <button
              key={ymd}
              type="button"
              onMouseEnter={() => setHover(ymd)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(ymd)}
              onBlur={() => setHover(null)}
              onClick={() => handleDayClick(ymd)}
              className={cn(
                "h-8 text-xs rounded-md tabular-nums transition-colors",
                "text-gray-700 hover:bg-gray-100",
                between && "bg-gray-100 text-gray-800",
                (start || end) && "bg-gray-900 text-white hover:bg-gray-900",
                isToday && !start && !end && "ring-1 ring-inset ring-gray-300"
              )}
            >
              {cell.day}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-between px-1">
        <p className="text-[11px] text-gray-400 tabular-nums">
          {pendingFrom ? formatYmdForDisplay(pendingFrom, locale) : "—"}
          {" – "}
          {pendingTo ? formatYmdForDisplay(pendingTo, locale) : "—"}
        </p>
        <button
          type="button"
          disabled={!canApply}
          onClick={() => {
            if (pendingFrom && pendingTo) onApply(pendingFrom, pendingTo)
          }}
          className={cn(
            "h-8 px-3 rounded-md text-xs font-medium transition-colors",
            canApply
              ? "bg-gray-900 text-white hover:bg-gray-800"
              : "bg-gray-100 text-gray-300 cursor-not-allowed"
          )}
        >
          {tApply("apply")}
        </button>
      </div>
    </div>
  )
}

// ─── Month grid builder ───────────────────────────────────────────────────

type Cell = { day: number; ymd: string } | null

function buildMonthGrid(year: number, month: number): Cell[] {
  // First day of month (UTC anchor).
  const first = new Date(Date.UTC(year, month - 1, 1))
  // 0 = Monday … 6 = Sunday
  const leading = (first.getUTCDay() + 6) % 7
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()

  const cells: Cell[] = []
  for (let i = 0; i < leading; i++) cells.push(null)
  for (let d = 1; d <= lastDay; d++) cells.push({ day: d, ymd: formatYmd(year, month, d) })
  // Pad to multiple of 7.
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}
