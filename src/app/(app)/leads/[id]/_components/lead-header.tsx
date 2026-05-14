import Link from "next/link"
import { ArrowLeft, Phone, Mail, MapPin, Calendar } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { Database } from "@/types/database"
import { getTranslations, getLocale } from "next-intl/server"

type LeadStatus = Database["public"]["Enums"]["lead_status"]

const STATUS_CLASS: Record<LeadStatus, string> = {
  new:             "border-zinc-700 text-zinc-400",
  contacted:       "border-blue-500/40 text-blue-400",
  qualified:       "border-violet-500/40 text-violet-400",
  appointment_set: "border-amber-500/40 text-amber-400",
  sold:            "border-emerald-500/40 text-emerald-400",
  lost:            "border-red-500/40 text-red-500",
  on_hold:         "border-yellow-500/40 text-yellow-500",
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
    created_at: string
    brand: { name: string; brand_color: string | null } | null
    rep: { name: string } | null
  }
}

export async function LeadHeader({ lead }: Props) {
  const ts = await getTranslations("status")
  const tl = await getTranslations("leads")
  const locale = await getLocale()
  const label = ts(lead.status)
  const className = STATUS_CLASS[lead.status] ?? "border-zinc-700 text-zinc-400"
  const createdLabel = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
  }).format(new Date(lead.created_at))

  return (
    <div className="space-y-4">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Leads
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground leading-tight">
            {lead.first_name} {lead.last_name ?? ""}
          </h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-normal ${className}`}>
              {label}
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
            <span className="flex items-center gap-1 text-[10px] text-zinc-600">
              <Calendar className="w-2.5 h-2.5" />
              {tl("createdOn", { date: createdLabel })}
            </span>
          </div>
        </div>

        {lead.ai_score !== null && (
          <div className="text-right shrink-0">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Score</p>
            <p className="text-2xl font-semibold tabular-nums" style={{ color: "var(--brand)" }}>
              {lead.ai_score}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
        <a
          href={`tel:${lead.phone}`}
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <Phone className="w-3.5 h-3.5" />
          <span className="font-mono">{lead.phone}</span>
        </a>
        {lead.phone_alt && (
          <a
            href={`tel:${lead.phone_alt}`}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <Phone className="w-3.5 h-3.5 opacity-50" />
            <span className="font-mono">{lead.phone_alt}</span>
          </a>
        )}
        {lead.email && (
          <a
            href={`mailto:${lead.email}`}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
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
