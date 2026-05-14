import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { dismissUrgentLead } from "../actions"
import type { UrgentLead } from "@/lib/queries/dashboard"
import { formatCurrency } from "@/lib/queries/dashboard"
import { getTranslations } from "next-intl/server"

async function getUrgentSubtext(lead: UrgentLead): Promise<string> {
  const t = await getTranslations("dashboard")
  switch (lead.reason) {
    case "stale":
      return t("daysSinceContact", { days: lead.days_stale ?? "?" })
    case "unconfirmed_appt":
      return t("unconfirmedApptLabel")
    case "payment_overdue":
      return `${t("paymentOverdueLabel")}${lead.amount_cents ? ` · ${formatCurrency(lead.amount_cents)}` : ""}`
  }
}

function UrgentBadge({ lead, urgentLabel, todayLabel }: { lead: UrgentLead; urgentLabel: string; todayLabel: string }) {
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
        {urgentLabel}
      </Badge>
    )
  }
  if (lead.reason === "unconfirmed_appt") {
    return (
      <Badge variant="outline" className="border-gray-200 text-zinc-500 text-[10px] px-1.5 py-0 font-normal">
        {todayLabel}
      </Badge>
    )
  }
  return null
}

export async function UrgentLeadList({ leads }: { leads: UrgentLead[] }) {
  const t = await getTranslations("dashboard")
  const urgentLabel = t("urgentLabel")
  const todayLabel = t("todayLabel")

  if (leads.length === 0) {
    return (
      <Card className="bg-white border-gray-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-gray-500">{t("urgentLeads")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <p className="text-sm text-gray-400">{t("pipelineGood")}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-white border-gray-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-gray-500">
          {t("urgentLeads")}
          <span className="ml-2 text-gray-400 font-normal text-xs">({leads.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {leads.map(async (lead, i) => {
          const subtext = await getUrgentSubtext(lead)
          return (
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
                  <p className="text-[11px] text-gray-400">{subtext}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <UrgentBadge lead={lead} urgentLabel={urgentLabel} todayLabel={todayLabel} />
                  <form action={dismissUrgentLead.bind(null, lead.id, lead.reason)}>
                    <button
                      type="submit"
                      className="text-gray-300 hover:text-gray-500 transition-colors text-xs cursor-pointer"
                      title={t("markContactedTitle")}
                    >
                      ✓
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
