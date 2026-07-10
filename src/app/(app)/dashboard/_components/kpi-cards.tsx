import { Card, CardContent } from "@/components/ui/card"
import { Phone, CalendarDays, DollarSign, Clock } from "lucide-react"
import { formatCurrency } from "@/lib/queries/dashboard"
import type { CallsKpi, ApptsKpi, SalesKpi, PendingKpi } from "@/lib/queries/dashboard"
import { getTranslations } from "next-intl/server"

export { formatCurrency }

// ── Mini-gráficas (SVG puro, sin librerías) ──────────────────────────────────

// Sparkline de área: tendencia de 7 días con relleno degradado y punto final.
function Sparkline({ values, stroke, gradId }: { values: number[]; stroke: string; gradId: string }) {
  const w = 92, h = 34
  const n = values.length
  const max = Math.max(1, ...values)
  const step = n > 1 ? w / (n - 1) : w
  const pts = values.map((v, i): [number, number] => [i * step, h - (v / max) * (h - 5) - 3])
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")
  const area = `${line} L${w},${h} L0,${h} Z`
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-[92px] h-9 overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={stroke} />
    </svg>
  )
}

// Barras: una por día; la última (hoy) resaltada.
function Bars({ values, color, hi }: { values: number[]; color: string; hi: string }) {
  const w = 92, h = 34, n = values.length
  const gap = 4
  const bw = (w - gap * (n - 1)) / n
  const max = Math.max(1, ...values)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-[92px] h-9" aria-hidden>
      {values.map((v, i) => {
        const bh = Math.max(2, (v / max) * (h - 2))
        return (
          <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx="2" fill={i === n - 1 ? hi : color} />
        )
      })}
    </svg>
  )
}

// Anillo: proporción (0..1) — para "% vencido" de pagos pendientes.
function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 15
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(1, pct))
  return (
    <svg viewBox="0 0 40 40" className="w-11 h-11" aria-hidden>
      <circle cx="20" cy="20" r={r} fill="none" stroke="#EFE8DA" strokeWidth="5" />
      <circle
        cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform="rotate(-90 20 20)"
      />
    </svg>
  )
}

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
  chart,
  children,
}: {
  label: string
  value: React.ReactNode
  sub: string
  icon?: React.ReactNode
  chart?: React.ReactNode
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
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-3xl font-semibold text-[#1A2E28] tabular-nums leading-none tracking-tight">
              {value}
            </p>
            <p className="text-[11px] text-[#93A39D] mt-1.5 leading-snug">{sub}</p>
          </div>
          {chart && <div className="shrink-0 self-center">{chart}</div>}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

export async function CallsKpiCard({ data, label, trend }: { data: CallsKpi; label?: string; trend?: number[] }) {
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
      chart={trend ? <Sparkline values={trend} stroke="#5F8CE6" gradId="spk-calls" /> : undefined}
    >
      {data.goal !== null && <ProgressBar value={data.total} max={data.goal} />}
    </KpiShell>
  )
}

export async function ApptsKpiCard({ data, label, trend }: { data: ApptsKpi; label?: string; trend?: number[] }) {
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
      chart={trend ? <Bars values={trend} color="#E4D3AE" hi="#E0A64E" /> : undefined}
    />
  )
}

export async function SalesKpiCard({ data, label, trend }: { data: SalesKpi; label?: string; trend?: number[] }) {
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
      chart={trend ? <Sparkline values={trend} stroke="#3FA278" gradId="spk-sales" /> : undefined}
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

  // Anillo: proporción de pagos pendientes que ya están vencidos (>7 días).
  const overduePct = data.count > 0 ? data.overdue_count / data.count : 0

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
      chart={<Ring pct={overduePct} color="#EF7B5C" />}
    />
  )
}
