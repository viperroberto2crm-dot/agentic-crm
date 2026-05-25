import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import Link from "next/link"
import type { TodayAppt } from "@/lib/queries/dashboard"
import { getTranslations } from "next-intl/server"
import { EditAppointmentButton } from "@/app/(app)/appointments/_components/edit-appointment-button"

type ClinicOption = {
  id: string
  name: string
  address_line1: string | null
  city: string | null
  state: string | null
}

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
  label,
  clinics,
  userRole,
}: {
  appts: TodayAppt[]
  timezone: string
  label?: string
  clinics: ClinicOption[]
  userRole?: string
}) {
  const t = await getTranslations("dashboard")
  const title = label ?? t("apptsToday")

  if (appts.length === 0) {
    return (
      <Card className="bg-white border-gray-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-gray-500">{title}</CardTitle>
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
          {title}
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
                <EditAppointmentButton
                  appointment={{
                    id: appt.id,
                    lead_id: appt.lead_id,
                    type: appt.type,
                    status: appt.status,
                    scheduled_at: appt.scheduled_at,
                    duration_minutes: appt.duration_minutes,
                    service: appt.service,
                    notes: appt.notes,
                    clinic_id: appt.clinic_id,
                    telehealth_link: appt.telehealth_link,
                  }}
                  leads={[
                    {
                      id: appt.lead_id,
                      first_name: appt.lead_first_name,
                      last_name: appt.lead_last_name,
                      phone: appt.lead_phone,
                      address_line1: appt.lead_address_line1,
                      address_line2: appt.lead_address_line2,
                      city: appt.lead_city,
                      state: appt.lead_state,
                      zip: appt.lead_zip,
                    },
                  ]}
                  clinics={clinics}
                  userRole={userRole}
                />
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
