import { Card, CardContent } from "@/components/ui/card"
import { formatCurrency } from "@/lib/queries/dashboard"
import type { CallsKpi, ApptsKpi, SalesKpi, PendingKpi } from "@/lib/queries/dashboard"

export { formatCurrency }

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="mt-2.5 h-[3px] w-full bg-zinc-800 rounded-full overflow-hidden">
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
    <Card className="bg-zinc-900 border-zinc-800/60">
      <CardContent className="p-4">
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-2">
          {label}
        </p>
        <p className="text-2xl font-semibold text-zinc-100 tabular-nums leading-none">
          {value}
        </p>
        <p className="text-[11px] text-zinc-600 mt-1.5 leading-snug">{sub}</p>
        {children}
      </CardContent>
    </Card>
  )
}

export function CallsKpiCard({ data }: { data: CallsKpi }) {
  const sub =
    data.total === 0
      ? "Aún sin actividad hoy"
      : `${data.connected} contactadas · ${data.to_appt} → cita`

  const value = (
    <>
      {data.total}
      {data.goal !== null && (
        <span className="text-zinc-600 text-lg font-normal"> / {data.goal}</span>
      )}
    </>
  )

  return (
    <KpiShell label="Llamadas hoy" value={value} sub={sub}>
      {data.goal !== null && <ProgressBar value={data.total} max={data.goal} />}
    </KpiShell>
  )
}

export function ApptsKpiCard({ data }: { data: ApptsKpi }) {
  const sub =
    data.total === 0
      ? "Sin citas hoy"
      : `${data.confirmed} confirmadas · ${data.pending} pendiente`

  return <KpiShell label="Citas hoy" value={data.total} sub={sub} />
}

export function SalesKpiCard({ data }: { data: SalesKpi }) {
  const sub =
    data.count === 0
      ? "Sin ventas registradas"
      : `${data.count} venta${data.count !== 1 ? "s" : ""} cerrada${data.count !== 1 ? "s" : ""}`

  return (
    <KpiShell
      label="Ventas hoy"
      value={data.total_cents === 0 ? "$0" : formatCurrency(data.total_cents)}
      sub={sub}
    />
  )
}

export function PendingKpiCard({ data }: { data: PendingKpi }) {
  let sub: string
  if (data.count === 0) {
    sub = "Sin pagos pendientes"
  } else {
    sub = `${data.count} pago${data.count !== 1 ? "s" : ""} pendiente${data.count !== 1 ? "s" : ""}`
    if (data.overdue_count > 0) sub += ` · +${data.overdue_count} vencido${data.overdue_count !== 1 ? "s" : ""}`
  }

  return (
    <KpiShell
      label="Por cobrar"
      value={data.total_cents === 0 ? "$0" : formatCurrency(data.total_cents)}
      sub={sub}
    />
  )
}
