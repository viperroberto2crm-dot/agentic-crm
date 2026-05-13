import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Phone } from "lucide-react"
import { daysAgo, type LeadRow } from "@/lib/queries/leads"
import type { Database } from "@/types/database"

type LeadStatus = Database["public"]["Enums"]["lead_status"]

const STATUS_CONFIG: Record<
  LeadStatus,
  { label: string; className: string }
> = {
  new: { label: "Nuevo", className: "border-gray-300 text-gray-500" },
  contacted: { label: "Contactado", className: "border-blue-500/40 text-blue-400" },
  qualified: { label: "Calificado", className: "border-violet-500/40 text-violet-400" },
  appointment_set: { label: "Cita", className: "border-amber-500/40 text-amber-400" },
  sold: { label: "Vendido", className: "border-emerald-500/40 text-emerald-400" },
  lost: { label: "Perdido", className: "border-red-500/40 text-red-500" },
  on_hold: { label: "En pausa", className: "border-yellow-500/40 text-yellow-500" },
}

function StatusBadge({ status }: { status: LeadStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: "border-gray-300 text-gray-500" }
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 font-normal ${cfg.className}`}
    >
      {cfg.label}
    </Badge>
  )
}

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-300 text-xs">—</span>
  const color =
    score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500"
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-10 h-1 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] text-gray-400 tabular-nums">{score}</span>
    </div>
  )
}

export function LeadsTable({ leads, logQuickCall }: {
  leads: LeadRow[]
  logQuickCall: (leadId: string, _: FormData) => Promise<void>
}) {
  if (leads.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-gray-400">
        No hay leads con estos filtros.{" "}
        <Link href="/leads/new" className="text-gray-500 underline underline-offset-2 hover:text-gray-900">
          Crear uno nuevo
        </Link>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 min-w-[180px]">
              Lead
            </th>
            <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
              Status
            </th>
            <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">
              Rep
            </th>
            <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden sm:table-cell">
              Último contacto
            </th>
            <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 hidden lg:table-cell">
              Score
            </th>
            <th className="pb-2 w-8" />
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr
              key={lead.id}
              className="border-b border-gray-100 hover:bg-gray-50 transition-colors group"
            >
              {/* Name + phone */}
              <td className="py-3 pr-4">
                <Link
                  href={`/leads/${lead.id}`}
                  className="font-medium text-gray-800 hover:text-gray-900 transition-colors block leading-tight"
                >
                  {lead.first_name} {lead.last_name ?? ""}
                </Link>
                <span className="text-[11px] text-gray-400 font-mono">
                  {lead.phone}
                </span>
              </td>

              {/* Status */}
              <td className="py-3 pr-4">
                <StatusBadge status={lead.status} />
              </td>

              {/* Rep */}
              <td className="py-3 pr-4 hidden md:table-cell">
                <span className="text-xs text-gray-400">
                  {lead.rep?.name ?? "—"}
                </span>
              </td>

              {/* Last contact */}
              <td className="py-3 pr-4 hidden sm:table-cell">
                <span className="text-xs text-gray-400">
                  {daysAgo(lead.last_contacted_at)}
                </span>
              </td>

              {/* Score */}
              <td className="py-3 hidden lg:table-cell">
                <ScoreBar score={lead.ai_score} />
              </td>

              {/* Quick call action */}
              <td className="py-3 w-8">
                <form action={logQuickCall.bind(null, lead.id)}>
                  <button
                    type="submit"
                    title="Registrar llamada rápida"
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-zinc-300 cursor-pointer"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
