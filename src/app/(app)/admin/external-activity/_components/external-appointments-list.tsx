"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { CalendarClock, ArrowRight } from "lucide-react"
import { formatApptDateTime, formatDate } from "@/lib/datetime"

export type ExternalAppointmentRow = {
  id: string
  provider: string | null
  status: string | null
  service: string | null
  /** Nombre legible del servicio (mapa de ofertas) o "Cita agendada". */
  serviceLabel: string
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

function customerLabel(row: ExternalAppointmentRow): string | null {
  return row.customer_name || row.customer_email || row.customer_phone || null
}

function statusChip(status: string | null): { label: string; bg: string; text: string; dot: string } {
  const s = (status ?? "").toLowerCase()
  if (["completed", "done", "checked_in"].includes(s)) return { label: "Completada", bg: "#E6F3EC", text: "#2E7E5B", dot: "#3FA278" }
  if (["cancelled", "canceled", "declined"].includes(s)) return { label: "Cancelada", bg: "#FAEBEA", text: "#B85D5B", dot: "#D5807E" }
  if (["no_show", "noshow"].includes(s)) return { label: "No asistió", bg: "#FAEBEA", text: "#B85D5B", dot: "#D5807E" }
  if (["pending"].includes(s)) return { label: "Pendiente", bg: "#FBF1DD", text: "#B67C22", dot: "#D79A3E" }
  // booked / scheduled / accepted / confirmed / activo
  return { label: "Agendada", bg: "#E4F2EE", text: "#2E8B6F", dot: "#3FA278" }
}

export function ExternalAppointmentsList({ appointments }: Props) {
  const t = useTranslations("externalActivity")

  if (appointments.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#ECE3D3] py-10 text-center">
        <p className="text-sm text-[#93A39D]">{t("noAppointments")}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {appointments.map((a) => {
        const customer = customerLabel(a)
        const linked = Boolean(a.lead_id)
        const ts = a.starts_at ? new Date(a.starts_at).getTime() : NaN
        const upcoming = !Number.isNaN(ts) && ts > Date.now()
        // Acento: sin vincular = coral (riesgo de perderse); próxima = verde; pasada = neutro.
        const accent = !linked ? "#EF7B5C" : upcoming ? "#3FA278" : "#D8CDB5"
        const chip = statusChip(a.status)
        const when = a.starts_at ? formatApptDateTime(a.starts_at) : formatDate(a.created_at)

        return (
          <div
            key={a.id}
            className="relative flex items-center gap-4 rounded-2xl border border-[#ECE3D3] bg-card p-4 pl-5 shadow-[0_1px_2px_rgba(26,46,40,0.04),0_8px_22px_-16px_rgba(26,46,40,0.14)] overflow-hidden transition-shadow hover:shadow-[0_2px_6px_rgba(26,46,40,0.06),0_16px_34px_-18px_rgba(26,46,40,0.22)]"
          >
            <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: accent }} />

            <span
              className="w-11 h-11 rounded-xl grid place-items-center shrink-0"
              style={{ background: upcoming ? "#E4F2EE" : "#F0EBE0" }}
            >
              <CalendarClock className="w-5 h-5" style={{ color: upcoming ? "#2E8B6F" : "#8A968F" }} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-[15px] text-[#20342C] truncate">
                  {customer || <span className="text-[#B7AE9C]">Sin nombre</span>}
                </span>
                {upcoming && (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[#2E8B6F] bg-[#E4F2EE] rounded-full px-2 py-0.5 shrink-0">
                    Próxima
                  </span>
                )}
              </div>
              <div className="text-[12.5px] text-[#5C6F68] truncate" title={a.service ?? ""}>
                {a.serviceLabel} · {a.brandLabel}
              </div>
              {customer && (a.customer_email || a.customer_phone) && (
                <div className="text-[11.5px] text-[#93A39D] truncate">{a.customer_email || a.customer_phone}</div>
              )}
            </div>

            <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
              <div className="font-semibold text-[13.5px] text-[#20342C] tabular-nums whitespace-nowrap">{when}</div>
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap"
                  style={{ backgroundColor: chip.bg, color: chip.text }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: chip.dot }} />
                  {chip.label}
                </span>
                {linked ? (
                  <Link
                    href={`/leads/${a.lead_id}`}
                    className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11.5px] font-semibold text-[#2E8B6F] bg-[#E4F2EE] hover:bg-[#D6EBE2] transition-colors max-w-[150px]"
                  >
                    <span className="truncate">{a.leadName || t("viewLead")}</span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-bold text-[#C56A3E] bg-[#FCE9E2] whitespace-nowrap">
                    ⚠ Sin vincular
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
