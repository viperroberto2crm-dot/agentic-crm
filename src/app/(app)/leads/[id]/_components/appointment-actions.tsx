"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DateTimeAmPm } from "@/components/ui/datetime-ampm"
import { brandLocalToIso, isoToBrandLocal } from "@/lib/appointment-tz"
import { fetchAppointmentById, updateAppointment } from "@/app/(app)/appointments/actions"

type AppointmentType = "clinic" | "home" | "telehealth"
type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show"
  | "rescheduled"

type LeadAddress = {
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

const STATUSES: AppointmentStatus[] = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
]

const inputCls =
  "bg-white border-gray-200 text-gray-800 placeholder:text-gray-400 h-9"

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-500">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

export function AppointmentActions({
  appointmentId,
  clinics,
  leadAddress,
}: {
  appointmentId: string
  clinics: ClinicOption[]
  leadAddress: LeadAddress
}) {
  const t = useTranslations("appointments")
  const tc = useTranslations("common")
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    type: "telehealth" as AppointmentType,
    status: "scheduled" as AppointmentStatus,
    scheduled_at: "",
    duration_minutes: 30,
    service: "",
    notes: "",
    clinic_id: "",
    telehealth_link: "",
  })

  const hasLeadAddress =
    !!leadAddress.address_line1 &&
    leadAddress.address_line1.trim().length > 0 &&
    !!leadAddress.city &&
    leadAddress.city.trim().length > 0
  const hasClinics = clinics.length > 0

  // Carga los datos reales de la cita al abrir (una sola query, siempre fresca).
  async function handleOpen() {
    setOpen(true)
    setLoading(true)
    setError(null)
    setNotFound(false)
    try {
      const appt = await fetchAppointmentById(appointmentId)
      if (!appt) {
        // Cita ajena/borrada: fetchAppointmentById scopea por rol → null.
        // Sin esto, el form quedaría con defaults y "guardar" daría un
        // éxito falso (update de 0 filas no lanza error en Supabase).
        setNotFound(true)
        return
      }
      setForm({
        type: appt.type,
        status: appt.status,
        scheduled_at: appt.scheduled_at ? isoToBrandLocal(appt.scheduled_at) : "",
        duration_minutes: appt.duration_minutes ?? 30,
        service: appt.service ?? "",
        notes: appt.notes ?? "",
        clinic_id: appt.clinic_id ?? "",
        telehealth_link: appt.telehealth_link ?? "",
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("savingError"))
    } finally {
      setLoading(false)
    }
  }

  const disableSubmit =
    isPending ||
    loading ||
    (form.type === "home" && !hasLeadAddress) ||
    (form.type === "clinic" && (!hasClinics || !form.clinic_id))

  function handleSave() {
    if (!form.scheduled_at) {
      setError(t("leadAndDateRequired"))
      return
    }
    if (form.type === "clinic" && (!hasClinics || !form.clinic_id)) {
      setError(hasClinics ? t("selectClinic") : t("noClinicsAvailable"))
      return
    }
    if (form.type === "home" && !hasLeadAddress) {
      setError(t("addressMissing"))
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await updateAppointment({
          id: appointmentId,
          type: form.type,
          status: form.status,
          // Interpreta como BRAND_TZ, igual que al crear, para evitar desfases.
          scheduled_at: brandLocalToIso(form.scheduled_at),
          duration_minutes: form.duration_minutes,
          service: form.service || null,
          notes: form.notes || null,
          clinic_id: form.type === "clinic" ? form.clinic_id || null : null,
          address_line1: form.type === "home" ? leadAddress.address_line1 : null,
          address_line2: form.type === "home" ? leadAddress.address_line2 : null,
          city: form.type === "home" ? leadAddress.city : null,
          state: form.type === "home" ? leadAddress.state : null,
          zip: form.type === "home" ? leadAddress.zip : null,
          telehealth_link:
            form.type === "telehealth"
              ? form.telehealth_link.trim() || null
              : null,
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
      <button
        type="button"
        onClick={handleOpen}
        className="shrink-0 text-gray-300 hover:text-gray-600 transition-colors cursor-pointer"
        aria-label={t("editAppointment")}
        title={t("editAppointment")}
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            setOpen(false)
            setError(null)
          }
        }}
      >
        <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {t("editAppointment")}
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <p className="text-sm text-gray-400 py-8 text-center">{tc("saving")}</p>
          ) : notFound ? (
            <div className="space-y-4 pt-2">
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-3">
                {tc("savingError")}
              </p>
              <Button
                variant="ghost"
                className="text-gray-400 hover:text-gray-700"
                onClick={() => setOpen(false)}
              >
                {tc("cancel")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("type")} required>
                  <Select
                    value={form.type}
                    onValueChange={(v) =>
                      setForm((p) => ({ ...p, type: v as AppointmentType }))
                    }
                  >
                    <SelectTrigger className="h-9 bg-white border-gray-200 text-gray-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-gray-200">
                      <SelectItem value="telehealth" className="text-gray-800">
                        {t("types.telehealth")}
                      </SelectItem>
                      <SelectItem value="home" className="text-gray-800">
                        {t("types.home")}
                      </SelectItem>
                      <SelectItem value="clinic" className="text-gray-800">
                        {t("types.clinic")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("status")}>
                  <Select
                    value={form.status}
                    onValueChange={(v) =>
                      setForm((p) => ({ ...p, status: v as AppointmentStatus }))
                    }
                  >
                    <SelectTrigger className="h-9 bg-white border-gray-200 text-gray-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-gray-200">
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s} className="text-gray-800">
                          {t(`appointmentStatuses.${s}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label={t("durationMin")}>
                <Input
                  type="number"
                  className={inputCls}
                  value={form.duration_minutes}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      duration_minutes: parseInt(e.target.value) || 30,
                    }))
                  }
                />
              </Field>

              {form.type === "telehealth" && (
                <Field label={t("telehealthLink")}>
                  <Input
                    type="url"
                    placeholder="https://"
                    className={inputCls}
                    value={form.telehealth_link}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, telehealth_link: e.target.value }))
                    }
                  />
                </Field>
              )}

              {form.type === "home" && (
                <div className="text-xs bg-gray-50 border border-gray-200 rounded px-3 py-2 text-gray-700">
                  {hasLeadAddress ? (
                    <span>
                      {leadAddress.address_line1}, {leadAddress.city}{" "}
                      {leadAddress.state ?? ""} {leadAddress.zip ?? ""}
                    </span>
                  ) : (
                    <span className="text-red-500">{t("addressMissing")}</span>
                  )}
                </div>
              )}

              {form.type === "clinic" && (
                <Field label={t("types.clinic")} required>
                  {hasClinics ? (
                    <Select
                      value={form.clinic_id}
                      onValueChange={(v) =>
                        setForm((p) => ({ ...p, clinic_id: v }))
                      }
                    >
                      <SelectTrigger className="h-9 bg-white border-gray-200 text-gray-700">
                        <SelectValue placeholder={t("selectClinic")} />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200 max-h-52 overflow-y-auto">
                        {clinics.map((c) => (
                          <SelectItem
                            key={c.id}
                            value={c.id}
                            className="text-gray-800"
                          >
                            {c.name}
                            {c.city ? ` — ${c.city}` : ""}
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
                  required
                />
              </Field>

              <Field label={t("service")}>
                <Input
                  className={inputCls}
                  value={form.service}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, service: e.target.value }))
                  }
                />
              </Field>

              <Field label={t("notes")}>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, notes: e.target.value }))
                  }
                  className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700 resize-none"
                />
              </Field>

              {error && (
                <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
                  {error}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <Button
                  onClick={handleSave}
                  disabled={disableSubmit}
                  className="cursor-pointer"
                  style={{ background: "var(--brand)" }}
                >
                  {isPending ? tc("saving") : tc("save")}
                </Button>
                <Button
                  variant="ghost"
                  className="text-gray-400 hover:text-gray-700"
                  onClick={() => {
                    setOpen(false)
                    setError(null)
                  }}
                  disabled={isPending}
                >
                  {tc("cancel")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
