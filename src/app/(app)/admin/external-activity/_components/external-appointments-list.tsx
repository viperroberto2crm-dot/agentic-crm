"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { formatApptDateTime, formatDate } from "@/lib/datetime"

export type ExternalAppointmentRow = {
  id: string
  provider: string | null
  status: string | null
  service: string | null
  staff: string | null
  starts_at: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  lead_id: string | null
  created_at: string
  /** Resuelto en el server: nombre de la clínica, "Sin Asignar" o "—". */
  brandLabel: string
  /** Resuelto en el server: nombre del lead vinculado (o null). */
  leadName: string | null
}

type Props = {
  appointments: ExternalAppointmentRow[]
}

function providerLabel(provider: string | null): string {
  if (provider === "square") return "Square"
  if (provider === "stripe") return "Stripe"
  return provider ?? "—"
}

function customerLabel(row: ExternalAppointmentRow): string | null {
  return row.customer_name || row.customer_email || row.customer_phone || null
}

export function ExternalAppointmentsList({ appointments }: Props) {
  const t = useTranslations("externalActivity")

  if (appointments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-8 text-center">
        <p className="text-sm text-muted-foreground">{t("noAppointments")}</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/40">
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">
              {t("colProvider")}
            </th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">
              {t("colCustomer")}
            </th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">
              {t("colClinic")}
            </th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">
              {t("colService")}
            </th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">
              {t("colWhen")}
            </th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">
              {t("colLead")}
            </th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((a) => {
            const customer = customerLabel(a)
            return (
              <tr
                key={a.id}
                className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
              >
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center text-[11px] bg-secondary text-muted-foreground border border-border rounded-full px-2 py-0.5 font-medium">
                    {providerLabel(a.provider)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-foreground">
                  <span className="block truncate max-w-[200px]">
                    {customer || <span className="text-muted-foreground/50">—</span>}
                  </span>
                  {customer && (a.customer_email || a.customer_phone) && (
                    <span className="block text-xs text-muted-foreground truncate max-w-[200px]">
                      {a.customer_email || a.customer_phone || ""}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell truncate max-w-[160px]">
                  {a.brandLabel}
                </td>
                <td className="px-3 py-2.5 text-foreground">
                  <span className="block truncate max-w-[200px]">
                    {a.service || <span className="text-muted-foreground/50">—</span>}
                    {a.staff && (
                      <span className="text-muted-foreground"> · {a.staff}</span>
                    )}
                  </span>
                  {a.status && (
                    <span className="block text-[10px] text-muted-foreground capitalize">
                      {a.status}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell whitespace-nowrap tabular-nums text-xs">
                  {a.starts_at
                    ? formatApptDateTime(a.starts_at)
                    : formatDate(a.created_at)}
                </td>
                <td className="px-3 py-2.5">
                  {a.lead_id ? (
                    <Link
                      href={`/leads/${a.lead_id}`}
                      className="inline-flex items-center text-xs font-medium text-[hsl(var(--accent))] hover:underline truncate max-w-[160px]"
                    >
                      {a.leadName || t("viewLead")}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center text-[11px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-full px-2 py-0.5 font-medium">
                      {t("unlinked")}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
