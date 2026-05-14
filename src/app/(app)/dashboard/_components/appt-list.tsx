import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import Link from "next/link"
import { confirmAppointment } from "../actions"
import type { TodayAppt } from "@/lib/queries/dashboard"
import { getTranslations } from "next-intl/server"

function formatTime(isoString: string, timezone: string): string {
  return new Date(isoString).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function apptSubtext(appt: TodayAppt): string {
  const typeLabel = appt.type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())

  const location = appt.clinic_name
    ? appt.clinic_name
    : appt.telehealth_link
    ? "Telehealth"
    : [appt.address_line1, appt.city].filter(Boolean).join(", ") || "—"

  return `${appt.brand_name} · ${typeLabel} · ${location}`
}

export async function TodayApptList({
  appts,
  timezone,
}: {
  appts: TodayAppt[]
  timezone: string
}) {
  const t = await getTranslations("dashboard")
  const tAppts = await getTranslations("appointments")

  if (appts.length === 0) {
    return (
      <Card className="bg-white border-gray-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-gray-500">{t("apptsToday")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400">
            {t("noTodayAppts")}{" "}
            <Link
              href="/leads"
              className="underline underline-offset-2 hover:text-gray-500 transition-colors"
              style={{ color: "var(--brand)" }}
            >
              {t("staleLinkText")}
            </Link>
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-white border-gray-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-gray-500">
          {t("apptsToday")}
          <span className="ml-2 text-gray-400 font-normal text-xs">({appts.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {appts.map((appt, i) => (
          <div key={appt.id}>
            {i > 0 && <Separator className="bg-gray-100" />}
            <div className="px-6 py-2.5 flex items-center gap-3">
              <span className="text-[11px] font-mono text-gray-400 w-11 shrink-0 tabular-nums">
                {formatTime(appt.scheduled_at, timezone)}
              </span>
              <div className="flex-1 min-w-0">
                <Link
                  href={`/leads/${appt.lead_id}`}
                  className="text-sm font-medium text-gray-800 hover:text-gray-900 transition-colors truncate block"
                >
                  {appt.lead_first_name} {appt.lead_last_name ?? ""}
                </Link>
                <p className="text-[11px] text-gray-400 truncate">{apptSubtext(appt)}</p>
              </div>
              <div className="shrink-0">
                {appt.status === "confirmed" ? (
                  <Badge
                    className="text-[10px] px-1.5 py-0 border-0 font-normal"
                    style={{ background: "color-mix(in srgb, var(--brand) 15%, transparent)", color: "var(--brand)" }}
                  >
                    {tAppts("appointmentStatuses.confirmed")}
                  </Badge>
                ) : (
                  <form action={confirmAppointment.bind(null, appt.id)}>
                    <button
                      type="submit"
                      className="text-[11px] text-gray-400 border border-gray-300 rounded px-2 py-0.5 hover:text-gray-700 hover:border-gray-400 transition-colors cursor-pointer"
                    >
                      {tAppts("appointmentStatuses.scheduled")}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
