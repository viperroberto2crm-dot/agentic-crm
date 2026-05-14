"use client"

import { useState, useTransition } from "react"
import { Bell, Check } from "lucide-react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  getNotifications,
  markAllAsRead,
  markAsRead,
  type NotificationRow,
} from "@/app/(app)/_actions/notifications"

function relativeTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.round((now - then) / 1000)

  const isEs = locale === "es"
  const prefixPast = isEs ? "hace " : ""
  const suffixPast = isEs ? "" : " ago"

  const fmt = (n: number, esUnit: string, enUnit: string) => {
    const unit = isEs ? esUnit : enUnit
    return `${prefixPast}${n} ${unit}${suffixPast}`
  }

  if (diffSec < 60) return isEs ? "hace unos segundos" : "just now"
  const min = Math.floor(diffSec / 60)
  if (min < 60) return fmt(min, min === 1 ? "min" : "min", min === 1 ? "min" : "min")
  const hr = Math.floor(min / 60)
  if (hr < 24) return fmt(hr, hr === 1 ? "hora" : "horas", hr === 1 ? "hour" : "hours")
  const days = Math.floor(hr / 24)
  if (days < 7) return fmt(days, days === 1 ? "día" : "días", days === 1 ? "day" : "days")
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return fmt(weeks, weeks === 1 ? "semana" : "semanas", weeks === 1 ? "week" : "weeks")
  const months = Math.floor(days / 30)
  if (months < 12) return fmt(months, months === 1 ? "mes" : "meses", months === 1 ? "month" : "months")
  const years = Math.floor(days / 365)
  return fmt(years, years === 1 ? "año" : "años", years === 1 ? "year" : "years")
}

function targetPath(n: NotificationRow): string | null {
  if (n.related_lead_id) return `/leads/${n.related_lead_id}`
  // No dedicated detail pages for these yet; route to list as a sensible fallback,
  // but only when there's an entity FK so the user understands the context.
  if (n.related_sale_id) return `/sales`
  if (n.related_appointment_id) return `/appointments`
  if (n.related_call_id) return `/calls`
  return null
}

export function NotificationBell({ count }: { count: number }) {
  const t = useTranslations("notifications")
  const locale = useLocale()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setLoading(true)
      startTransition(async () => {
        try {
          const rows = await getNotifications()
          setItems(rows)
        } finally {
          setLoading(false)
        }
      })
    }
  }

  function handleItemClick(n: NotificationRow) {
    const path = targetPath(n)
    // Optimistic mark-as-read in local state so the dot disappears immediately
    setItems((prev) =>
      prev.map((row) =>
        row.id === n.id && !row.read_at
          ? { ...row, read_at: new Date().toISOString() }
          : row
      )
    )
    startTransition(async () => {
      if (!n.read_at) {
        await markAsRead(n.id)
      }
      if (path) {
        router.push(path)
      }
    })
    setOpen(false)
  }

  function handleMarkAllAsRead() {
    const now = new Date().toISOString()
    setItems((prev) =>
      prev.map((row) => (row.read_at ? row : { ...row, read_at: now }))
    )
    startTransition(async () => {
      await markAllAsRead()
    })
  }

  const hasUnread = items.some((n) => !n.read_at) || count > 0

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          className="relative w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
          aria-label={t("title")}
        >
          <Bell className="w-4 h-4" />
          {count > 0 && (
            <span
              className={cn(
                "absolute top-1 right-1 min-w-[14px] h-[14px] flex items-center justify-center",
                "rounded-full text-[9px] font-bold leading-none px-0.5",
                "bg-[hsl(var(--accent))] text-white tabular-nums"
              )}
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[360px] max-w-[calc(100vw-1rem)] p-0 bg-white border-gray-200 shadow-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">{t("title")}</p>
          {hasUnread && (
            <button
              type="button"
              onClick={handleMarkAllAsRead}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
            >
              <Check className="w-3 h-3" />
              {t("markAllAsRead")}
            </button>
          )}
        </div>

        {/* Body */}
        <div className="max-h-[420px] overflow-y-auto">
          {loading ? (
            <div className="px-3 py-6 text-center text-sm text-gray-400">
              {locale === "es" ? "Cargando…" : "Loading…"}
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-gray-500">
              {t("empty")}
            </div>
          ) : (
            <ul className="py-1">
              {items.map((n) => {
                const unread = !n.read_at
                const title = n.subject ?? n.type
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(n)}
                      className={cn(
                        "w-full text-left px-3 py-2.5 flex gap-2.5 transition-colors hover:bg-gray-50 focus:outline-none focus:bg-gray-50",
                        unread && "bg-blue-50/40"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1.5 w-2 h-2 rounded-full shrink-0",
                          unread ? "bg-[hsl(var(--accent))]" : "bg-transparent"
                        )}
                        aria-hidden
                      />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              "text-sm truncate",
                              unread
                                ? "font-semibold text-gray-900"
                                : "font-medium text-gray-700"
                            )}
                          >
                            {title}
                          </span>
                          <span className="text-[10px] text-gray-400 shrink-0 whitespace-nowrap">
                            {relativeTime(n.created_at, locale)}
                          </span>
                        </span>
                        <span
                          className="block text-xs text-gray-500 mt-0.5 overflow-hidden"
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
                          {n.body}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
