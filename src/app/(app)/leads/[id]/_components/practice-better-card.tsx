import { Calendar, DollarSign, CheckCircle2, Clock } from "lucide-react"
import { formatApptDateTime, formatDate } from "@/lib/datetime"

// Card de solo lectura: muestra las citas y pagos que el polling trae de
// Practice Better para este lead. Datos pre-cargados en page.tsx (server).

export type PbAppt = {
  id: string
  name: string | null
  status: string | null
  scheduled_at: string | null
}
export type PbPayment = {
  id: string
  amount_cents: number
  currency: string | null
  status: string | null
  paid_at: string | null
  number: string | null
}

function fmtMoney(cents: number, currency: string | null): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency && currency.length === 3 ? currency.toUpperCase() : "USD",
  })
}

export function PracticeBetterCard({
  appointments,
  payments,
}: {
  appointments: PbAppt[]
  payments: PbPayment[]
}) {
  const totalPaidCents = payments.reduce((s, p) => s + (p.amount_cents ?? 0), 0)
  const currency = payments[0]?.currency ?? "USD"
  const hasData = appointments.length > 0 || payments.length > 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
          Practice Better
        </p>
        {payments.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {fmtMoney(totalPaidCents, currency)} total
          </span>
        )}
      </div>

      {!hasData && (
        <p className="text-xs text-muted-foreground">
          Sin citas ni pagos sincronizados todavía.
        </p>
      )}

      {appointments.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-[#5C6F68] flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" /> Citas ({appointments.length})
          </p>
          {appointments.map((a) => (
            <div key={a.id} className="flex items-center gap-2 py-1.5 border-b border-[#F2EFE9] last:border-0">
              <span className="text-[11px] text-muted-foreground w-28 shrink-0 tabular-nums">
                {a.scheduled_at ? formatApptDateTime(a.scheduled_at) : "—"}
              </span>
              <span className="text-sm text-gray-700 flex-1 truncate">{a.name ?? "Cita"}</span>
              {a.status && (
                <span className="text-[10px] text-[#2E8B6F] capitalize shrink-0">{a.status}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {payments.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-[#5C6F68] flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5" /> Pagos ({payments.length})
          </p>
          {payments.map((p) => {
            const paid = p.status?.toLowerCase().includes("paid") || Boolean(p.paid_at)
            return (
              <div key={p.id} className="flex items-center gap-2 py-1.5 border-b border-[#F2EFE9] last:border-0">
                {paid ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#2E8B6F] shrink-0" />
                ) : (
                  <Clock className="w-3.5 h-3.5 text-[#D9A441] shrink-0" />
                )}
                <span className="text-[11px] text-muted-foreground w-20 shrink-0 tabular-nums">
                  {p.paid_at ? formatDate(p.paid_at) : "—"}
                </span>
                <span className="text-sm font-medium text-gray-700 tabular-nums flex-1">
                  {fmtMoney(p.amount_cents, p.currency)}
                </span>
                {p.number && (
                  <span className="text-[10px] text-muted-foreground shrink-0">#{p.number}</span>
                )}
                {p.status && (
                  <span className="text-[10px] text-muted-foreground capitalize shrink-0">{p.status}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
