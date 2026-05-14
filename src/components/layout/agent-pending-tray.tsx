"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { BotMessageSquare, Check, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  approvePendingAction,
  listPendingActions,
  rejectPendingAction,
} from "@/app/(app)/_actions/agent-pending"
import type { Database } from "@/types/database"

type PendingRow = Database["public"]["Tables"]["agent_pending_actions"]["Row"]

function relativeTime(iso: string, locale: string): string {
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  const isEs = locale === "es"
  if (diffSec < 60) return isEs ? "hace unos segundos" : "just now"
  const min = Math.floor(diffSec / 60)
  if (min < 60) return isEs ? `hace ${min} min` : `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return isEs ? `hace ${hr}h` : `${hr}h ago`
  const days = Math.floor(hr / 24)
  return isEs ? `hace ${days}d` : `${days}d ago`
}

function buildTitle(
  row: PendingRow,
  t: ReturnType<typeof useTranslations>,
): string {
  const payload = (row.payload ?? {}) as Record<string, unknown>
  switch (row.action_type) {
    case "create_task": {
      const title = typeof payload.title === "string" ? payload.title : "—"
      return t("actions.create_task", { title })
    }
    case "update_lead_status": {
      const status =
        typeof payload.new_status === "string" ? payload.new_status : "—"
      return t("actions.update_lead_status", { status })
    }
    case "log_call_note": {
      const outcome =
        typeof payload.outcome === "string" ? payload.outcome : "—"
      return t("actions.log_call_note", { outcome })
    }
    default:
      return row.action_type
  }
}

export function AgentPendingTray({
  initialCount,
  visible,
}: {
  initialCount: number
  visible: boolean
}) {
  const t = useTranslations("agentPending")
  const locale = useLocale()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<PendingRow[]>([])
  const [count, setCount] = useState(initialCount)
  const [loading, setLoading] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  if (!visible) return null

  function refresh() {
    setLoading(true)
    startTransition(async () => {
      try {
        const rows = await listPendingActions()
        setItems(rows)
        setCount(rows.length)
      } finally {
        setLoading(false)
      }
    })
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) refresh()
  }

  function handleApprove(id: string) {
    setPendingId(id)
    startTransition(async () => {
      const res = await approvePendingAction(id)
      if (res.ok) {
        setItems((prev) => prev.filter((r) => r.id !== id))
        setCount((c) => Math.max(0, c - 1))
        router.refresh()
      }
      setPendingId(null)
    })
  }

  function handleReject(id: string) {
    setPendingId(id)
    startTransition(async () => {
      const res = await rejectPendingAction(id)
      if (res.ok) {
        setItems((prev) => prev.filter((r) => r.id !== id))
        setCount((c) => Math.max(0, c - 1))
        router.refresh()
      }
      setPendingId(null)
    })
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          className="relative w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
          aria-label={t("title")}
        >
          <BotMessageSquare className="w-4 h-4" />
          {count > 0 && (
            <span
              className={cn(
                "absolute top-1 right-1 min-w-[14px] h-[14px] flex items-center justify-center",
                "rounded-full text-[9px] font-bold leading-none px-0.5",
                "bg-[hsl(var(--accent))] text-white tabular-nums",
              )}
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[380px] max-w-[calc(100vw-1rem)] p-0 bg-white border-gray-200 shadow-lg"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">{t("title")}</p>
          <span className="text-[10px] text-gray-400">{t("awaitingApproval")}</span>
        </div>

        <div className="max-h-[460px] overflow-y-auto">
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
              {items.map((row) => {
                const title = buildTitle(row, t)
                const isBusy = pendingId === row.id
                return (
                  <li key={row.id} className="px-3 py-2.5 border-b border-gray-50 last:border-b-0">
                    <div className="flex items-start gap-2.5">
                      <BotMessageSquare className="w-3.5 h-3.5 mt-1 text-gray-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {title}
                          </p>
                          <span className="text-[10px] text-gray-400 shrink-0 whitespace-nowrap">
                            {relativeTime(row.created_at, locale)}
                          </span>
                        </div>
                        {row.reasoning && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                            {row.reasoning}
                          </p>
                        )}
                        {row.related_lead_id && (
                          <Link
                            href={`/leads/${row.related_lead_id}`}
                            onClick={() => setOpen(false)}
                            className="text-[11px] text-[hsl(var(--accent))] hover:underline mt-1 inline-block"
                          >
                            {locale === "es" ? "Ver lead →" : "View lead →"}
                          </Link>
                        )}
                        <div className="flex gap-1.5 mt-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleApprove(row.id)}
                            className="inline-flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                          >
                            <Check className="w-3 h-3" />
                            {t("approve")}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleReject(row.id)}
                            className="inline-flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                          >
                            <X className="w-3 h-3" />
                            {t("reject")}
                          </button>
                        </div>
                      </div>
                    </div>
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
