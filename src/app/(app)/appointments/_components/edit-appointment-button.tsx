"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DateTimeAmPm } from "@/components/ui/datetime-ampm"
import { updateAppointment } from "../actions"

type Lead = {
  id: string
  first_name: string
  last_name: string | null
  phone: string
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
}

type ClinicOption = {
  id: string
  name: string
  address_line1: string | null
  city: string | null
  state: string | null
}

type AppointmentType = "clinic" | "home" | "telehealth"
type AppointmentStatus = "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show"

export type EditableAppointment = {
  id: string
  lead_id: string | null
  type: AppointmentType
  status: AppointmentStatus
  scheduled_at: string
  duration_minutes: number
  service: string | null
  notes: string | null
  clinic_id: string | null
  telehealth_link: string | null
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-500">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputCls = "bg-white border-gray-200 text-gray-800 placeholder:text-gray-400 h-9"

/**
 * Convierte un ISO string a formato local datetime-local input (YYYY-MM-DDTHH:mm).
 * Le aplica la timezone del browser para que el datetime-local muestre la hora local.
 */
function isoToDatetimeLocal(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function EditAppointmentButton({
  appointment,
  leads,
  clinics,
  userRole,
}: {
  appointment: EditableAppointment
  leads: Lead[]
  clinics: ClinicOption[]
  userRole?: string
}) {
  const isProvider = userRole === "provider"
  const t = useTranslations("appointments")
  const tc = useTranslations("common")
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    type: appointment.type,
    status: appointment.status,
    scheduled_at: isoToDatetimeLocal(appointment.scheduled_at),
    duration_minutes: appointment.duration_minutes,
    service: appointment.service ?? "",
    notes: appointment.notes ?? "",
    clinic_id: appointment.clinic_id ?? "",
    telehealth_link: appointment.telehealth_link ?? "",
  })

  // Reset form to current appointment values whenever the dialog opens
  useEffect(() => {
    if (open) {
      setForm({
        type: appointment.type,
        status: appointment.status,
        scheduled_at: isoToDatetimeLocal(appointment.scheduled_at),
        duration_minutes: appointment.duration_minutes,
        service: appointment.service ?? "",
        notes: appointment.notes ?? "",
        clinic_id: appointment.clinic_id ?? "",
        telehealth_link: appointment.telehealth_link ?? "",
      })
      setError(null)
    }
  }, [open, appointment])

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === appointment.lead_id) ?? null,
    [leads, appointment.lead_id]
  )

  const hasLeadAddress =
    !!selectedLead &&
    !!selectedLead.address_line1 &&
    selectedLead.address_line1.trim().length > 0 &&
    !!selectedLead.city &&
    selectedLead.city.trim().length > 0

  const hasClinics = clinics.length > 0

  const addressSummary =
    selectedLead && hasLeadAddress
      ? t("addressFromLead", {
          address: selectedLead.address_line1 ?? "",
          city: selectedLead.city ?? "",
          state: selectedLead.state ?? "",
          zip: selectedLead.zip ?? "",
        })
      : ""

  const disableSubmit =
    isPending ||
    (form.type === "home" && (!selectedLead || !hasLeadAddress)) ||
    (form.type === "clinic" && (!hasClinics || !form.clinic_id)) ||
    !form.scheduled_at

  function handleSave() {
    if (!form.scheduled_at) {
      setError(t("leadAndDateRequired"))
      return
    }
    if (form.type === "home" && !hasLeadAddress) {
      setError(t("addressMissing"))
      return
    }
    if (form.type === "clinic" && (!hasClinics || !form.clinic_id)) {
      setError(hasClinics ? t("selectClinic") : t("noClinicsAvailable"))
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await updateAppointment({
          id: appointment.id,
          type: form.type,
          status: form.status,
          scheduled_at: new Date(form.scheduled_at).toISOString(),
          duration_minutes: form.duration_minutes,
          service: form.service || null,
          notes: form.notes || null,
          clinic_id: form.type === "clinic" ? form.clinic_id || null : null,
          address_line1: form.type === "home" ? selectedLead?.address_line1 ?? null : null,
          address_line2: form.type === "home" ? selectedLead?.address_line2 ?? null : null,
          city: form.type === "home" ? selectedLead?.city ?? null : null,
          state: form.type === "home" ? selectedLead?.state ?? null : null,
          zip: form.type === "home" ? selectedLead?.zip ?? null : null,
          telehealth_link:
            form.type === "telehealth" ? form.telehealth_link.trim() || null : null,
        })
        router.refresh()
        setOpen(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("savingError"))
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        title={tc("edit")}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        className="h-7 w-7 p-0 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      >
        <Pencil className="w-3.5 h-3.5" />
        <span className="sr-only">{tc("edit")}</span>
      </Button>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">{t("editAppointment")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Lead (read-only — para cambiar lead, mejor crear cita nueva) */}
            <Field label="Lead">
              <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                {selectedLead
                  ? `${selectedLead.first_name} ${selectedLead.last_name ?? ""} — ${selectedLead.phone}`
                  : "—"}
              </div>
            </Field>

            <Field label={t("status")} required>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((p) => ({ ...p, status: v as AppointmentStatus }))}
              >
                <SelectTrigger className="h-9 bg-white border-gray-200 text-gray-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-gray-200">
                  <SelectItem value="scheduled" className="text-gray-800">{t("appointmentStatuses.scheduled")}</SelectItem>
                  <SelectItem value="confirmed" className="text-gray-800">{t("appointmentStatuses.confirmed")}</SelectItem>
                  <SelectItem value="completed" className="text-gray-800">{t("appointmentStatuses.completed")}</SelectItem>
                  <SelectItem value="cancelled" className="text-gray-800">{t("appointmentStatuses.cancelled")}</SelectItem>
                  <SelectItem value="no_show" className="text-gray-800">{t("appointmentStatuses.no_show")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("type")} required>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm((p) => ({ ...p, type: v as AppointmentType }))}
                  disabled={isProvider}
                >
                  <SelectTrigger className="h-9 bg-white border-gray-200 text-gray-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-gray-200">
                    <SelectItem value="telehealth" className="text-gray-800">{t("types.telehealth")}</SelectItem>
                    <SelectItem value="home" className="text-gray-800">{t("types.home")}</SelectItem>
                    <SelectItem value="clinic" className="text-gray-800">{t("types.clinic")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("durationMin")}>
                <Input
                  type="number"
                  className={inputCls}
                  value={form.duration_minutes}
                  onChange={(e) => setForm((p) => ({ ...p, duration_minutes: parseInt(e.target.value) || 30 }))}
                  disabled={isProvider}
                />
              </Field>
            </div>

            {form.type === "telehealth" && (
              <Field label={t("telehealthLink")}>
                <Input
                  type="url"
                  placeholder="https://"
                  className={inputCls}
                  value={form.telehealth_link}
                  onChange={(e) => setForm((p) => ({ ...p, telehealth_link: e.target.value }))}
                  disabled={isProvider}
                />
              </Field>
            )}

            {form.type === "home" && (
              <div className="space-y-2">
                {!selectedLead ? (
                  <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                    {t("selectLead")}
                  </div>
                ) : hasLeadAddress ? (
                  <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                    {addressSummary}
                  </div>
                ) : (
                  <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-3 py-2">
                    {t("addressMissing")}
                  </div>
                )}
              </div>
            )}

            {form.type === "clinic" && (
              <Field label={t("types.clinic")} required>
                {hasClinics ? (
                  <Select
                    value={form.clinic_id}
                    onValueChange={(v) => setForm((p) => ({ ...p, clinic_id: v }))}
                    disabled={isProvider}
                  >
                    <SelectTrigger className="h-9 bg-white border-gray-200 text-gray-700">
                      <SelectValue placeholder={t("selectClinic")} />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-gray-200 max-h-52 overflow-y-auto">
                      {clinics.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-gray-800">
                          {c.name}{c.city ? ` — ${c.city}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-3 py-2">
                    {t("noClinicsAvailable")}
                  </div>
                )}
              </Field>
            )}

            <Field label={t("dateTime")} required>
              <DateTimeAmPm
                value={form.scheduled_at}
                onChange={(v) => setForm((p) => ({ ...p, scheduled_at: v }))}
                disabled={isProvider}
                required
              />
            </Field>

            <Field label={t("service")}>
              <Input
                className={inputCls}
                value={form.service}
                onChange={(e) => setForm((p) => ({ ...p, service: e.target.value }))}
                disabled={isProvider}
              />
            </Field>

            <Field label={t("notes")}>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                disabled={isProvider}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700 resize-none disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </Field>

            {error && (
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3 pt-1">
              <Button onClick={handleSave} disabled={disableSubmit} className="cursor-pointer" style={{ background: "var(--brand)" }}>
                {isPending ? tc("saving") : tc("save")}
              </Button>
              <Button variant="ghost" className="text-gray-400 hover:text-gray-700" onClick={() => setOpen(false)} disabled={isPending}>
                {tc("cancel")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
