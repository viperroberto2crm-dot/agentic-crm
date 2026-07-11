import {
  Calendar,
  DollarSign,
  CheckCircle2,
  Clock,
  RotateCcw,
  XCircle,
  Globe,
  Building2,
  FileText,
  CreditCard,
} from "lucide-react"
import { formatApptDateTime, formatDate } from "@/lib/datetime"

// Card de solo lectura: pagos y citas que los webhooks de Square/Stripe
// escriben en external_payments / external_appointments para este lead.
// Datos pre-cargados en page.tsx (server). Mismo patrón visual que la card
// de Practice Better (paleta crema/verde, íconos SVG de línea, sin emojis).

export type ExternalPayment = {
  id: string
  provider: string | null
  amount_cents: number
  currency: string | null
  status: string | null
  origin: string | null
  items: string | null
  reference: string | null
  paid_at: string | null
}
export type ExternalAppointment = {
  id: string
  provider: string | null
  status: string | null
  service: string | null
  service_name: string | null
  staff: string | null
  staff_name: string | null
  starts_at: string | null
  ends_at: string | null
}

function fmtMoney(cents: number, currency: string | null): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency && currency.length === 3 ? currency.toUpperCase() : "USD",
  })
}

// Clasifica el pago SOLO por su status (paid_at siempre viene seteado por los
// webhooks como fecha del evento, NO como prueba de cobro). "settled" = dinero
// realmente cobrado; failed/pending/unpaid NO cuentan como cobrado.
type PayState = "settled" | "refunded" | "failed" | "pending"
function classifyPayment(status: string | null): PayState {
  const s = (status ?? "").toLowerCase()
  if (s === "refunded") return "refunded"
  if (s === "failed" || s === "canceled" || s === "cancelled") return "failed"
  if (s === "completed" || s === "paid") return "settled"
  return "pending" // pending, unpaid, approved, no_payment_required, unknown...
}

function normCurrency(c: string | null): string {
  return c && c.length === 3 ? c.toUpperCase() : "USD"
}

function providerLabel(provider: string | null): string {
  if (provider === "square") return "Square"
  if (provider === "stripe") return "Stripe"
  return provider ?? ""
}

// Ícono por origen del pago (web / clínica / factura / otro).
function OriginIcon({ origin }: { origin: string | null }) {
  const cls = "w-3.5 h-3.5 text-[#5C6F68] shrink-0"
  switch (origin) {
    case "web":
      return <Globe className={cls} />
    case "in_person":
      return <Building2 className={cls} />
    case "invoice":
      return <FileText className={cls} />
    default:
      return <CreditCard className={cls} />
  }
}

function originLabel(origin: string | null): string {
  switch (origin) {
    case "web":
      return "Página web"
    case "in_person":
      return "Clínica"
    case "invoice":
      return "Factura"
    default:
      return "Otro"
  }
}

export function ExternalPaymentsCard({
  payments,
  appointments,
}: {
  payments: ExternalPayment[]
  appointments: ExternalAppointment[]
}) {
  // Total cobrado NETO: suma settled y resta refunded, solo de la moneda
  // principal (no se pueden sumar centavos de monedas distintas). failed y
  // pending no cuentan. La fila de refund es aparte (${id}_refund) → se resta.
  const currency = normCurrency(payments[0]?.currency ?? null)
  const totalPaidCents = payments.reduce((s, p) => {
    if (normCurrency(p.currency) !== currency) return s
    const st = classifyPayment(p.status)
    if (st === "settled") return s + (p.amount_cents ?? 0)
    if (st === "refunded") return s - (p.amount_cents ?? 0)
    return s
  }, 0)
  const mixedCurrency = payments.some((p) => normCurrency(p.currency) !== currency)
  const hasData = appointments.length > 0 || payments.length > 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
          Pagos y citas
        </p>
        {payments.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {fmtMoney(totalPaidCents, currency)}
            {mixedCurrency ? ` ${currency}` : ""} cobrado
          </span>
        )}
      </div>

      {/* Estado vacío consistente con la card de Practice Better */}
      {!hasData && (
        <p className="text-xs text-muted-foreground">
          Aún no hay pagos ni citas externas para este lead.
        </p>
      )}

      {payments.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-[#5C6F68] flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5" /> Pagos ({payments.length})
          </p>
          {payments.map((p) => {
            const state = classifyPayment(p.status)
            return (
              <div
                key={p.id}
                className="flex items-center gap-2 py-1.5 border-b border-[#F2EFE9] last:border-0"
              >
                {state === "refunded" ? (
                  <RotateCcw className="w-3.5 h-3.5 text-[#E07856] shrink-0" />
                ) : state === "failed" ? (
                  <XCircle className="w-3.5 h-3.5 text-[#C4453B] shrink-0" />
                ) : state === "pending" ? (
                  <Clock className="w-3.5 h-3.5 text-[#D9A441] shrink-0" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#2E8B6F] shrink-0" />
                )}
                <span className="text-[11px] text-muted-foreground w-20 shrink-0 tabular-nums">
                  {p.paid_at ? formatDate(p.paid_at) : "—"}
                </span>
                <span
                  className={`text-sm font-medium tabular-nums shrink-0 w-20 ${
                    state === "refunded"
                      ? "text-[#E07856]"
                      : state === "failed"
                        ? "text-[#C4453B] line-through"
                        : "text-gray-700"
                  }`}
                >
                  {state === "refunded" ? "-" : ""}
                  {fmtMoney(p.amount_cents, p.currency)}
                </span>
                <span className="flex items-center gap-1 flex-1 min-w-0">
                  <OriginIcon origin={p.origin} />
                  <span className="text-xs text-muted-foreground truncate">
                    {p.items || originLabel(p.origin)}
                  </span>
                </span>
                {p.provider && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {providerLabel(p.provider)}
                  </span>
                )}
                {p.status && (
                  <span className="text-[10px] text-muted-foreground capitalize shrink-0">
                    {p.status}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {appointments.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-[#5C6F68] flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" /> Citas ({appointments.length})
          </p>
          {appointments.map((a) => {
            const cancelled =
              a.status?.toLowerCase() === "cancelled" ||
              a.status?.toLowerCase() === "no_show"
            return (
              <div
                key={a.id}
                className="flex items-center gap-2 py-1.5 border-b border-[#F2EFE9] last:border-0"
              >
                <span className="text-[11px] text-muted-foreground w-28 shrink-0 tabular-nums">
                  {a.starts_at ? formatApptDateTime(a.starts_at) : "—"}
                </span>
                <span className="text-sm text-gray-700 flex-1 truncate">
                  {a.service_name ?? a.service ?? "Cita"}
                  {(a.staff_name ?? a.staff) && (
                    <span className="text-muted-foreground"> · {a.staff_name ?? a.staff}</span>
                  )}
                </span>
                {a.provider && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {providerLabel(a.provider)}
                  </span>
                )}
                {a.status && (
                  <span
                    className={`text-[10px] capitalize shrink-0 ${
                      cancelled ? "text-[#E07856]" : "text-[#2E8B6F]"
                    }`}
                  >
                    {a.status}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
