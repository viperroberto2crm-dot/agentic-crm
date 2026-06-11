import { Card, CardContent } from "@/components/ui/card"
import { Phone, CalendarDays, DollarSign, Clock } from "lucide-react"
import { formatCurrency } from "@/lib/queries/dashboard"
import type { CallsKpi, ApptsKpi, SalesKpi, PendingKpi } from "@/lib/queries/dashboard"
import { getTranslations } from "next-intl/server"

export { formatCurrency }

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="mt-2.5 h-[3px] w-full bg-[#EFECE5] rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: "var(--brand)" }}
      />
    </div>
  )
}

function KpiShell({
  label,
  value,
  sub,
  icon,
  children,
}: {
  label: string
  value: React.ReactNode
  sub: string
  icon?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <Card className="bg-white rounded-2xl border-[#E8E4DC]/60 shadow-[0_1px_2px_rgba(26,46,40,.05),0_2px_8px_rgba(26,46,40,.04)]">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-[10px] text-[#5C6F68] uppercase tracking-widest font-semibold pt-1">
            {label}
          </p>
          {icon}
        </div>
        <p className="font-display text-3xl font-semibold text-[#1A2E28] tabular-nums leading-none tracking-tight">
          {value}
        </p>
        <p className="text-[11px] text-[#93A39D] mt-1.5 leading-snug">{sub}</p>
        {children}
      </CardContent>
    </Card>
  )
}

export async function CallsKpiCard({ data, label }: { data: CallsKpi; label?: string }) {
  const t = await getTranslations("dashboard")
  const sub =
    data.total === 0
      ? t("noActivityToday")
      : `${data.connected} ${t("contactedLabel")} · ${data.to_appt} ${t("toApptLabel")}`

  const value = (
    <>
      {data.total}
      {data.goal !== null && (
        <span className="text-[#93A39D] text-lg font-normal"> / {data.goal}</span>
      )}
    </>
  )

  return (
    <KpiShell
      label={label ?? t("callsToday")}
      value={value}
      sub={sub}
      icon={
        <span className="w-8 h-8 rounded-[10px] bg-[#E8F0FC] flex items-center justify-center shrink-0">
          <Phone className="w-4 h-4 text-[#3D7BD9]" />
        </span>
      }
    >
      {data.goal !== null && <ProgressBar value={data.total} max={data.goal} />}
    </KpiShell>
  )
}

export async function ApptsKpiCard({ data, label }: { data: ApptsKpi; label?: string }) {
  const t = await getTranslations("dashboard")
  const sub =
    data.total === 0
      ? t("noApptsToday")
      : `${data.confirmed} ${t("confirmedLabel")} · ${data.pending} ${t("pendingLabel")}`

  return (
    <KpiShell
      label={label ?? t("apptsToday")}
      value={data.total}
      sub={sub}
      icon={
        <span className="w-8 h-8 rounded-[10px] bg-[#FAF0DC] flex items-center justify-center shrink-0">
          <CalendarDays className="w-4 h-4 text-[#D9A441]" />
        </span>
      }
    />
  )
}

export async function SalesKpiCard({ data, label }: { data: SalesKpi; label?: string }) {
  const t = await getTranslations("dashboard")
  const sub =
    data.count === 0
      ? t("noSalesRegistered")
      : `${data.count} ${data.count !== 1 ? t("salePlural") : t("saleSingular")}`

  return (
    <KpiShell
      label={label ?? t("salesToday")}
      value={data.total_cents === 0 ? "$0" : formatCurrency(data.total_cents)}
      sub={sub}
      icon={
        <span className="w-8 h-8 rounded-[10px] bg-[#E3F0EB] flex items-center justify-center shrink-0">
          <DollarSign className="w-4 h-4 text-[#2E8B6F]" />
        </span>
      }
    />
  )
}

export async function PendingKpiCard({ data }: { data: PendingKpi }) {
  const t = await getTranslations("dashboard")
  let sub: string
  if (data.count === 0) {
    sub = t("noPendingPayments")
  } else {
    sub = `${data.count} ${data.count !== 1 ? t("paymentPlural") : t("paymentSingular")}`
    if (data.overdue_count > 0)
      sub += ` · +${data.overdue_count} ${data.overdue_count !== 1 ? t("overduePlural") : t("overdueSingular")}`
  }

  return (
    <KpiShell
      label={t("pendingTotal")}
      value={data.total_cents === 0 ? "$0" : formatCurrency(data.total_cents)}
      sub={sub}
      icon={
        <span className="w-8 h-8 rounded-[10px] bg-[#FFEBE9] flex items-center justify-center shrink-0">
          <Clock className="w-4 h-4 text-[#FF6B5E]" />
        </span>
      }
    />
  )
}
