import { Users, CalendarDays, DollarSign, Sparkles } from "lucide-react"
import { Sparkline, Bars, Ring, ChartCell } from "@/components/ui/mini-charts"
import { formatCurrency } from "@/lib/queries/dashboard"
import type { LeadsStats } from "@/lib/queries/leads-stats"

function StatCard({
  label,
  value,
  sub,
  iconBg,
  icon,
  chart,
}: {
  label: string
  value: React.ReactNode
  sub: string
  iconBg: string
  icon: React.ReactNode
  chart: React.ReactNode
}) {
  return (
    <div className="bg-card rounded-2xl border border-[#E8E4DC]/60 p-4 shadow-[0_1px_2px_rgba(26,46,40,.05),0_2px_8px_rgba(26,46,40,.04)]">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[10px] text-[#5C6F68] uppercase tracking-widest font-semibold pt-1">{label}</p>
        <span className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0" style={{ backgroundColor: iconBg }}>
          {icon}
        </span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-2xl font-semibold text-[#1A2E28] tabular-nums leading-none tracking-tight">
            {value}
          </p>
          <p className="text-[11px] text-[#93A39D] mt-1.5 leading-snug">{sub}</p>
        </div>
        <div className="shrink-0 self-center">{chart}</div>
      </div>
    </div>
  )
}

export function LeadsStatStrip({ stats, showUnassigned }: { stats: LeadsStats; showUnassigned: boolean }) {
  const assignedPct = stats.activeLeads > 0 ? (stats.activeLeads - stats.unassigned) / stats.activeLeads : 1

  return (
    <div className={`grid grid-cols-2 gap-3 ${showUnassigned ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
      <StatCard
        label="Leads activos"
        value={stats.activeLeads.toLocaleString()}
        sub={stats.newThisWeek > 0 ? `▲ ${stats.newThisWeek} nuevos (7 días)` : "sin nuevos en 7 días"}
        iconBg="#EAF0FD"
        icon={<Users className="w-4 h-4 text-[#5F8CE6]" />}
        chart={
          <ChartCell caption="nuevos · 7d" title={`Leads nuevos por día (últ. 7): ${stats.leadsTrend.join(" · ")}`}>
            <Sparkline values={stats.leadsTrend} stroke="#5F8CE6" gradId="ls-leads" />
          </ChartCell>
        }
      />

      <StatCard
        label="Citas esta semana"
        value={stats.apptsThisWeek}
        sub="lun a dom"
        iconBg="#FBF1DD"
        icon={<CalendarDays className="w-4 h-4 text-[#D9A441]" />}
        chart={
          <ChartCell caption="esta semana" title={`Citas por día esta semana (lun→dom): ${stats.apptsTrend.join(" · ")}`}>
            <Bars values={stats.apptsTrend} color="#E4D3AE" hi="#E0A64E" />
          </ChartCell>
        }
      />

      <StatCard
        label="Cobrado (mes)"
        value={stats.collectedCentsMonth === 0 ? "$0" : formatCurrency(stats.collectedCentsMonth)}
        sub="este mes"
        iconBg="#E6F3EC"
        icon={<DollarSign className="w-4 h-4 text-[#2E8B6F]" />}
        chart={
          <ChartCell caption="cierres · 7d" title={`Ventas cerradas por día (últ. 7): ${stats.salesTrend.join(" · ")}`}>
            <Sparkline values={stats.salesTrend} stroke="#3FA278" gradId="ls-sales" />
          </ChartCell>
        }
      />

      {showUnassigned && (
        <StatCard
          label="Sin asignar"
          value={stats.unassigned}
          sub={stats.unassigned > 0 ? "sin rep · por asignar" : "todo asignado"}
          iconBg="#FBE7DF"
          icon={<Sparkles className="w-4 h-4 text-[#EF7B5C]" />}
          chart={
            <ChartCell caption="asignado" title={`${stats.activeLeads - stats.unassigned} de ${stats.activeLeads} leads activos con rep`}>
              <Ring pct={assignedPct} color="#3FA278" />
            </ChartCell>
          }
        />
      )}
    </div>
  )
}
