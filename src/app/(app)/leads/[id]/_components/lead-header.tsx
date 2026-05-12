import Link from "next/link"
import { ArrowLeft, Phone, Mail, MapPin } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { Database } from "@/types/database"

type LeadStatus = Database["public"]["Enums"]["lead_status"]

const STATUS_CONFIG: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: "Nuevo", className: "border-zinc-700 text-zinc-400" },
  contacted: { label: "Contactado", className: "border-blue-500/40 text-blue-400" },
  qualified: { label: "Calificado", className: "border-violet-500/40 text-violet-400" },
  appointment_set: { label: "Cita", className: "border-amber-500/40 text-amber-400" },
  sold: { label: "Vendido", className: "border-emerald-500/40 text-emerald-400" },
  lost: { label: "Perdido", className: "border-red-500/40 text-red-500" },
  on_hold: { label: "En pausa", className: "border-yellow-500/40 text-yellow-500" },
}

type Props = {
  lead: {
    first_name: string
    last_name: string | null
    phone: string
    phone_alt: string | null
    email: string | null
    status: LeadStatus
    source: string | null
    city: string | null
    state: string | null
    ai_score: number | null
    brand: { name: string; brand_color: string | null } | null
    rep: { name: string } | null
  }
}

export function LeadHeader({ lead }: Props) {
  const cfg = STATUS_CONFIG[lead.status]

  return (
    <div className="space-y-4">
      {/* Back nav */}
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Leads
      </Link>

      {/* Name + status */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100 leading-tight">
            {lead.first_name} {lead.last_name ?? ""}
          </h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-normal ${cfg.className}`}>
              {cfg.label}
            </Badge>
            {lead.brand && (
              <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: lead.brand.brand_color ?? "#3B82F6" }}
                />
                {lead.brand.name}
              </span>
            )}
            {lead.rep && (
              <span className="text-[10px] text-zinc-600">
                Rep: {lead.rep.name}
              </span>
            )}
          </div>
        </div>

        {/* AI Score */}
        {lead.ai_score !== null && (
          <div className="text-right shrink-0">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Score</p>
            <p className="text-2xl font-semibold tabular-nums" style={{ color: "var(--brand)" }}>
              {lead.ai_score}
            </p>
          </div>
        )}
      </div>

      {/* Contact info */}
      <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
        <a
          href={`tel:${lead.phone}`}
          className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors"
        >
          <Phone className="w-3.5 h-3.5" />
          <span className="font-mono">{lead.phone}</span>
        </a>
        {lead.phone_alt && (
          <a
            href={`tel:${lead.phone_alt}`}
            className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors"
          >
            <Phone className="w-3.5 h-3.5 opacity-50" />
            <span className="font-mono">{lead.phone_alt}</span>
          </a>
        )}
        {lead.email && (
          <a
            href={`mailto:${lead.email}`}
            className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors"
          >
            <Mail className="w-3.5 h-3.5" />
            {lead.email}
          </a>
        )}
        {(lead.city || lead.state) && (
          <span className="flex items-center gap-1.5 text-zinc-600">
            <MapPin className="w-3.5 h-3.5" />
            {[lead.city, lead.state].filter(Boolean).join(", ")}
          </span>
        )}
      </div>
    </div>
  )
}
