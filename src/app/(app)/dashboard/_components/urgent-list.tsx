import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { dismissUrgentLead } from "../actions"
import type { UrgentLead } from "@/lib/queries/dashboard"
import { formatCurrency } from "@/lib/queries/dashboard"

function urgentSubtext(lead: UrgentLead): string {
  switch (lead.reason) {
    case "stale":
      return `${lead.days_stale ?? "?"} días sin contacto`
    case "unconfirmed_appt":
      return "Cita pendiente de confirmar"
    case "payment_overdue":
      return `Pago pendiente${lead.amount_cents ? ` · ${formatCurrency(lead.amount_cents)}` : ""}`
  }
}

function UrgentBadge({ lead }: { lead: UrgentLead }) {
  if (lead.reason === "payment_overdue") {
    return (
      <Badge variant="outline" className="border-amber-500/30 text-amber-500 text-[10px] px-1.5 py-0 font-normal">
        +{lead.days_stale ?? "?"} días
      </Badge>
    )
  }
  if (lead.reason === "stale" && (lead.days_stale ?? 0) > 7) {
    return (
      <Badge variant="outline" className="border-red-500/30 text-red-400 text-[10px] px-1.5 py-0 font-normal">
        Urgente
      </Badge>
    )
  }
  if (lead.reason === "unconfirmed_appt") {
    return (
      <Badge variant="outline" className="border-gray-200 text-zinc-500 text-[10px] px-1.5 py-0 font-normal">
        Hoy
      </Badge>
    )
  }
  return null
}

export function UrgentLeadList({ leads }: { leads: UrgentLead[] }) {
  if (leads.length === 0) {
    return (
      <Card className="bg-white border-gray-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-gray-500">Leads urgentes</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <p className="text-sm text-gray-400">Tu pipeline está al día. Buen trabajo.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-white border-gray-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-gray-500">
          Leads urgentes
          <span className="ml-2 text-gray-400 font-normal text-xs">({leads.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {leads.map((lead, i) => (
          <div key={lead.id}>
            {i > 0 && <Separator className="bg-gray-100" />}
            <div className="px-6 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <Link
                  href={`/leads/${lead.id}`}
                  className="text-sm font-medium text-gray-800 hover:text-gray-900 transition-colors block truncate"
                >
                  {lead.first_name} {lead.last_name ?? ""}
                </Link>
                <p className="text-[11px] text-gray-400">{urgentSubtext(lead)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <UrgentBadge lead={lead} />
                <form action={dismissUrgentLead.bind(null, lead.id, lead.reason)}>
                  <button
                    type="submit"
                    className="text-gray-300 hover:text-gray-500 transition-colors text-xs cursor-pointer"
                    title="Marcar como contactado"
                  >
                    ✓
                  </button>
                </form>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
