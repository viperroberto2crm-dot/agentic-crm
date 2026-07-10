import { UserPlus, DollarSign, Clock, CalendarDays, Phone } from "lucide-react"
import { DualLineChart, Gauge, DonutStat } from "@/components/ui/analytics-charts"
import type { DashboardAnalytics, RatioStat, FeedEvent } from "@/lib/queries/dashboard-analytics"

const pctLabel = (r: RatioStat): string => (r.ratio === null ? "—" : `${Math.round(r.ratio * 100)}%`)

function hace(at: string): string {
  const ms = Date.now() - new Date(at).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return "ahora"
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} d`
}

const CARD = "bg-white rounded-[22px] border border-[#E8E4DC]/60 shadow-[0_1px_2px_rgba(20,50,40,.04),0_12px_30px_-16px_rgba(20,50,40,.14)]"
const CAP = "text-[11px] uppercase tracking-[0.06em] text-[#8A968F] font-bold"

const FEED_STYLE: Record<FeedEvent["kind"], { bg: string; color: string; Icon: typeof UserPlus }> = {
  lead:      { bg: "#EAF0FD", color: "#5F8CE6", Icon: UserPlus },
  sale_paid: { bg: "#E7F2ED", color: "#2E8B6F", Icon: DollarSign },
  sale_open: { bg: "#FCE9E2", color: "#EF7B5C", Icon: Clock },
  appt:      { bg: "#FBF1DD", color: "#D9A441", Icon: CalendarDays },
  call:      { bg: "#EFEAF9", color: "#8E7CC3", Icon: Phone },
}

export function AnalyticsPanel({ data }: { data: DashboardAnalytics }) {
  const leads = data.weekly.map((w) => w.leads)
  const sales = data.weekly.map((w) => w.salesPaid)
  const hasSeries = leads.reduce((a, b) => a + b, 0) + sales.reduce((a, b) => a + b, 0) > 0
  const conv = data.conversion

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="font-display text-lg font-semibold tracking-tight text-[#1C2A24]">Analítica</h2>
        <span className="text-[11.5px] text-[#93A39D]">Últimas 8 semanas</span>
      </div>

      {/* Fila 1: gráfica grande + gauge */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-4">
        <div className={`${CARD} p-5`}>
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <div className={CAP}>Leads nuevos vs ventas cerradas</div>
              <div className="flex gap-4 mt-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] text-[#5C6F68] font-semibold">
                  <i className="w-2.5 h-2.5 rounded-full" style={{ background: "#2E8B6F" }} />Leads
                </span>
                <span className="inline-flex items-center gap-1.5 text-[12px] text-[#5C6F68] font-semibold">
                  <i className="w-2.5 h-2.5 rounded-full" style={{ background: "#EF7B5C" }} />Ventas
                </span>
              </div>
            </div>
          </div>
          {hasSeries ? (
            <div title={`Leads/semana: ${leads.join(" · ")}  |  Ventas/semana: ${sales.join(" · ")}`}>
              <DualLineChart a={leads} b={sales} colorA="#2E8B6F" colorB="#EF7B5C" gradId="an-funnel" />
            </div>
          ) : (
            <div className="h-[200px] grid place-items-center text-[13px] text-[#B7AE9C]">Sin actividad en las últimas 8 semanas</div>
          )}
        </div>

        <div className={`${CARD} p-5 flex flex-col`}>
          <div className={CAP}>Conversión de leads</div>
          <div className="flex-1 flex flex-col items-center justify-center py-2">
            <Gauge pct={conv.ratio ?? 0} />
            <div className="font-display text-[30px] font-semibold -mt-12 tabular-nums text-[#1C2A24]">{pctLabel(conv)}</div>
            <div className="text-[12.5px] text-[#8A968F] mt-1 text-center">
              {conv.denominator > 0 ? `${conv.numerator} de ${conv.denominator} leads → venta` : "sin leads en el periodo"}
            </div>
          </div>
        </div>
      </div>

      {/* Fila 2: 3 donas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`${CARD} p-5`}>
          <div className={`${CAP} mb-3`}>Citas cumplidas</div>
          <DonutStat pct={data.donuts.apptShowRate.ratio ?? 0} color="#2E8B6F"
            big={pctLabel(data.donuts.apptShowRate)}
            small={data.donuts.apptShowRate.denominator > 0 ? `${data.donuts.apptShowRate.numerator} de ${data.donuts.apptShowRate.denominator}` : "sin citas cerradas"} />
        </div>
        <div className={`${CARD} p-5`}>
          <div className={`${CAP} mb-3`}>Tasa de contacto</div>
          <DonutStat pct={data.donuts.callContactRate.ratio ?? 0} color="#E0A64E"
            big={pctLabel(data.donuts.callContactRate)}
            small={data.donuts.callContactRate.denominator > 0 ? `${data.donuts.callContactRate.numerator} de ${data.donuts.callContactRate.denominator} llamadas` : "sin llamadas"} />
        </div>
        <div className={`${CARD} p-5`}>
          <div className={`${CAP} mb-3`}>Pagos al día</div>
          <DonutStat pct={data.donuts.paymentsCurrent.ratio ?? 0} color="#EF7B5C"
            big={pctLabel(data.donuts.paymentsCurrent)}
            small={data.donuts.paymentsCurrent.denominator > 0 ? `${data.donuts.paymentsCurrent.denominator - data.donuts.paymentsCurrent.numerator} vencidos de ${data.donuts.paymentsCurrent.denominator}` : "sin pagos abiertos"} />
        </div>
      </div>

      {/* Fila 3: actividad reciente */}
      <div>
        <div className={`${CAP} mb-2 px-1`}>Actividad reciente</div>
        <div className={`${CARD} p-2`}>
          {data.activity.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-[#B7AE9C]">Sin actividad reciente</div>
          ) : (
            data.activity.map((ev, i) => {
              const s = FEED_STYLE[ev.kind]
              const Icon = s.Icon
              return (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-[#F6F9F6] transition-colors">
                  <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: s.bg }}>
                    <Icon className="w-4 h-4" style={{ color: s.color }} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-[#1C2A24] truncate">{ev.title}</div>
                    <div className="text-[11.5px] text-[#8A968F] truncate">{ev.detail}</div>
                  </div>
                  <span className="ml-auto text-[11.5px] text-[#93A39D] whitespace-nowrap">{hace(ev.at)}</span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </section>
  )
}
