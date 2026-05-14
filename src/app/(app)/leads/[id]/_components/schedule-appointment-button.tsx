"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { CalendarPlus } from "lucide-react"
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
import { createAppointment } from "@/app/(app)/appointments/actions"

type AppointmentType = "clinic" | "home" | "telehealth"

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

const inputCls =
  "bg-white border-gray-200 text-gray-800 placeholder:text-gray-400 h-9"

export function ScheduleAppointmentButton({
  leadId,
  brandId,
  leadAddress,
  clinics,
  onEditLead,
}: {
  leadId: string
  brandId: string
  leadAddress: LeadAddress
  clinics: ClinicOption[]
  onEditLead?: () => void
}) {
  const t = useTranslations("appointments")
  const tc = useTranslations("common")
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    type: "telehealth" as AppointmentType,
    scheduled_at: "",
    duration_minutes: 30,
    service: "",
    notes: "",
    clinic_id: "",
    telehealth_link: "",
  })

  useEffect(() => {
    // Clear conditional error when type changes
    setError(null)
  }, [form.type])

  const hasLeadAddress =
    !!leadAddress.address_line1 &&
    leadAddress.address_line1.trim().length > 0 &&
    !!leadAddress.city &&
    leadAddress.city.trim().length > 0

  const hasClinics = clinics.length > 0

  const addressSummary = hasLeadAddress
    ? t("addressFromLead", {
        address: leadAddress.address_line1 ?? "",
        city: leadAddress.city ?? "",
        state: leadAddress.state ?? "",
        zip: leadAddress.zip ?? "",
      })
    : ""

  const disableSubmit =
    isPending ||
    (form.type === "home" && !hasLeadAddress) ||
    (form.type === "clinic" && (!hasClinics || !form.clinic_id))

  function reset() {
    setForm({
      type: "telehealth",
      scheduled_at: "",
      duration_minutes: 30,
      service: "",
      notes: "",
      clinic_id: "",
      telehealth_link: "",
    })
    setError(null)
  }

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
        await createAppointment({
          brand_id: brandId,
          lead_id: leadId,
          type: form.type,
          scheduled_at: new Date(form.scheduled_at).toISOString(),
          duration_minutes: form.duration_minutes,
          service: form.service || null,
          notes: form.notes || null,
          clinic_id: form.type === "clinic" ? form.clinic_id || null : null,
          address_line1:
            form.type === "home" ? leadAddress.address_line1 : null,
          address_line2:
            form.type === "home" ? leadAddress.address_line2 : null,
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
        reset()
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("savingError"))
      }
    })
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-9 gap-1.5 cursor-pointer border-gray-300 text-gray-700 hover:text-gray-900 hover:bg-gray-100"
        onClick={() => setOpen(true)}
      >
        <CalendarPlus className="w-3.5 h-3.5" />
        {t("newAppointment")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            setOpen(false)
            reset()
          }
        }}
      >
        <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {t("newAppointment")}
            </DialogTitle>
          </DialogHeader>
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
            </div>

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
              <div className="space-y-2">
                {hasLeadAddress ? (
                  <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                    {addressSummary}
                  </div>
                ) : (
                  <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-3 py-2 flex flex-col gap-2">
                    <span>{t("addressMissing")}</span>
                    {onEditLead && (
                      <button
                        type="button"
                        onClick={onEditLead}
                        className="text-xs text-red-700 hover:text-red-900 font-medium underline self-start cursor-pointer"
                      >
                        {t("addressMissingAction")}
                      </button>
                    )}
                  </div>
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
              <Input
                type="datetime-local"
                className={inputCls}
                value={form.scheduled_at}
                onChange={(e) =>
                  setForm((p) => ({ ...p, scheduled_at: e.target.value }))
                }
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
                {isPending ? tc("saving") : t("scheduleAppt")}
              </Button>
              <Button
                variant="ghost"
                className="text-gray-400 hover:text-gray-700"
                onClick={() => {
                  setOpen(false)
                  reset()
                }}
                disabled={isPending}
              >
                {tc("cancel")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
