import { Phone, Calendar, DollarSign, StickyNote } from "lucide-react"
import { getTranslations } from "next-intl/server"
import type { Database } from "@/types/database"
import { BRAND_TIMEZONE } from "@/lib/datetime"
import { SaleActions } from "./sale-actions"

type CallRow = {
  id: string
  called_at: string
  direction: Database["public"]["Enums"]["call_direction"]
  outcome: Database["public"]["Enums"]["call_outcome"] | null
  duration_seconds: number | null
  notes: string | null
  source: string
}

type ApptRow = {
  id: string
  scheduled_at: string
  type: Database["public"]["Enums"]["appointment_type"]
  status: Database["public"]["Enums"]["appointment_status"]
  service: string | null
}

type SaleRow = {
  id: string
  created_at: string
  amount_cents: number
  payment_status: Database["public"]["Enums"]["payment_status"]
  payment_method: Database["public"]["Enums"]["payment_method"]
}

type Activity =
  | { kind: "call"; date: string; data: CallRow }
  | { kind: "appt"; date: string; data: ApptRow }
  | { kind: "sale"; date: string; data: SaleRow }

function formatDate(d: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BRAND_TIMEZONE,
  }).format(new Date(d))
}

function formatDuration(seconds: number | null) {
  if (!seconds) return null
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export async function ActivityTimeline({
  calls,
  appointments,
  sales,
  notes,
  leadId,
  planSaleIds = [],
}: {
  calls: CallRow[]
  appointments: ApptRow[]
  sales: SaleRow[]
  notes: string | null
  leadId?: string
  planSaleIds?: string[]
}) {
  const ta = await getTranslations("activity")
  const tCalls = await getTranslations("calls")
  const tAppts = await getTranslations("appointments")

  const activities: Activity[] = [
    ...calls.map((c) => ({ kind: "call" as const, date: c.called_at, data: c })),
    ...appointments.map((a) => ({ kind: "appt" as const, date: a.scheduled_at, data: a })),
    ...sales.map((s) => ({ kind: "sale" as const, date: s.created_at, data: s })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return (
    <div className="space-y-3">
      {notes && (
        <div className="flex gap-3 pb-3 border-b border-gray-200">
          <div className="mt-0.5 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
            <StickyNote className="w-3 h-3 text-gray-400" />
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">{ta("leadNotes")}</p>
            <p className="text-sm text-gray-500 leading-relaxed">{notes}</p>
          </div>
        </div>
      )}

      {activities.length === 0 && (
        <p className="text-sm text-gray-400 py-4 text-center">
          {ta("noActivity")}
        </p>
      )}

      {activities.map((act) => {
        if (act.kind === "call") {
          const c = act.data
          return (
            <div key={c.id} className="flex gap-3">
              <div className="mt-0.5 w-6 h-6 rounded-full bg-gray-100/80 flex items-center justify-center shrink-0">
                <Phone className="w-3 h-3 text-gray-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-700">
                    {c.direction === "outbound" ? ta("callOutbound") : ta("callInbound")}
                  </span>
                  {c.outcome && (
                    <span className="text-[10px] text-gray-400">
                      · {tCalls(`outcomes.${c.outcome}`)}
                    </span>
                  )}
                  {formatDuration(c.duration_seconds) && (
                    <span className="text-[10px] text-gray-300 tabular-nums">
                      {formatDuration(c.duration_seconds)}
                    </span>
                  )}
                </div>
                {c.notes && <p className="text-xs text-gray-400 mt-0.5">{c.notes}</p>}
                <p className="text-[10px] text-gray-300 mt-0.5">{formatDate(c.called_at)}</p>
              </div>
            </div>
          )
        }

        if (act.kind === "appt") {
          const a = act.data
          return (
            <div key={a.id} className="flex gap-3">
              <div className="mt-0.5 w-6 h-6 rounded-full bg-gray-100/80 flex items-center justify-center shrink-0">
                <Calendar className="w-3 h-3 text-gray-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-700">
                    {ta("apptLabel")} — {tAppts(`types.${a.type}`)}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    · {tAppts(`appointmentStatuses.${a.status}`)}
                  </span>
                </div>
                {a.service && <p className="text-xs text-gray-400 mt-0.5">{a.service}</p>}
                <p className="text-[10px] text-gray-300 mt-0.5">{formatDate(a.scheduled_at)}</p>
              </div>
            </div>
          )
        }

        if (act.kind === "sale") {
          const s = act.data
          const amount = (s.amount_cents / 100).toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
          })
          const isPlanLinked = planSaleIds.includes(s.id)
          return (
            <div key={s.id} className="flex gap-3">
              <div className="mt-0.5 w-6 h-6 rounded-full bg-emerald-900/40 flex items-center justify-center shrink-0">
                <DollarSign className="w-3 h-3 text-emerald-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-700">{ta("saleLabel")} — {amount}</span>
                  <span className="text-[10px] text-gray-400">
                    · {s.payment_status === "paid" ? ta("salePaid") : ta("salePending")} · {s.payment_method}
                  </span>
                </div>
                <p className="text-[10px] text-gray-300 mt-0.5">{formatDate(s.created_at)}</p>
              </div>
              {leadId && (
                <SaleActions
                  sale={{
                    id: s.id,
                    amount_cents: s.amount_cents,
                    payment_status: s.payment_status as "paid" | "pending" | "partial" | "failed" | "refunded",
                    payment_method: s.payment_method as "cash" | "card" | "stripe",
                  }}
                  leadId={leadId}
                  isPlanLinked={isPlanLinked}
                />
              )}
            </div>
          )
        }

        return null
      })}
    </div>
  )
}
