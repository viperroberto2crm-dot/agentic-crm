import { Card, CardContent } from "@/components/ui/card"
import { formatCurrency } from "@/lib/queries/dashboard"
import type { CallsKpi, ApptsKpi, SalesKpi, PendingKpi } from "@/lib/queries/dashboard"
import { getTranslations } from "next-intl/server"

export { formatCurrency }

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="mt-2.5 h-[3px] w-full bg-gray-200 rounded-full overflow-hidden">
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
  children,
}: {
  label: string
  value: React.ReactNode
  sub: string
  children?: React.ReactNode
}) {
  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="p-4">
        <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-2">
          {label}
        </p>
        <p className="text-2xl font-semibold text-gray-900 tabular-nums leading-none">
          {value}
        </p>
        <p className="text-[11px] text-gray-400 mt-1.5 leading-snug">{sub}</p>
        {children}
      </CardContent>
    </Card>
  )
}

export async function CallsKpiCard({ data }: { data: CallsKpi }) {
  const t = await getTranslations("dashboard")
  const sub =
    data.total === 0
      ? t("noActivityToday")
      : `${data.connected} ${t("contactedLabel")} · ${data.to_appt} ${t("toApptLabel")}`

  const value = (
    <>
      {data.total}
      {data.goal !== null && (
        <span className="text-gray-400 text-lg font-normal"> / {data.goal}</span>
      )}
    </>
  )

  return (
    <KpiShell label={t("callsToday")} value={value} sub={sub}>
      {data.goal !== null && <ProgressBar value={data.total} max={data.goal} />}
    </KpiShell>
  )
}

export async function ApptsKpiCard({ data }: { data: ApptsKpi }) {
  const t = await getTranslations("dashboard")
  const sub =
    data.total === 0
      ? t("noApptsToday")
      : `${data.confirmed} ${t("confirmedLabel")} · ${data.pending} ${t("pendingLabel")}`

  return <KpiShell label={t("apptsToday")} value={data.total} sub={sub} />
}

export async function SalesKpiCard({ data }: { data: SalesKpi }) {
  const t = await getTranslations("dashboard")
  const sub =
    data.count === 0
      ? t("noSalesRegistered")
      : `${data.count} ${data.count !== 1 ? t("salePlural") : t("saleSingular")}`

  return (
    <KpiShell
      label={t("salesToday")}
      value={data.total_cents === 0 ? "$0" : formatCurrency(data.total_cents)}
      sub={sub}
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
    />
  )
}
