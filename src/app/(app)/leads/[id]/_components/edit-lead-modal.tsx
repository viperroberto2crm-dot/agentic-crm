"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { updateLead, type UpdateLeadInput } from "../actions"
import type { Database } from "@/types/database"

type LeadStatus = Database["public"]["Enums"]["lead_status"]
type LeadSource = Database["public"]["Enums"]["lead_source"]

type LeadData = {
  id: string
  first_name: string
  last_name: string | null
  phone: string | null
  phone_alt: string | null
  email: string | null
  status: LeadStatus
  source: LeadSource | null
  assigned_rep_id: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  notes: string | null
}

type Rep = { id: string; name: string }

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

export function EditLeadModal({
  open, onClose, lead, reps,
}: {
  open: boolean
  onClose: () => void
  lead: LeadData
  reps: Rep[]
}) {
  const t = useTranslations("leads")
  const ts = useTranslations("status")
  const tsrc = useTranslations("source")
  const tc = useTranslations("common")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
    { value: "new", label: ts("new") },
    { value: "contacted", label: ts("contacted") },
    { value: "qualified", label: ts("qualified") },
    { value: "appointment_set", label: ts("appointment_set") },
    { value: "sold", label: ts("sold") },
    { value: "lost", label: ts("lost") },
    { value: "on_hold", label: ts("on_hold") },
    { value: "not_interested", label: ts("not_interested") },
  ]

  const SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
    { value: "inbound_call", label: tsrc("inbound_call") },
    { value: "web_form", label: tsrc("web_form") },
    { value: "referral", label: tsrc("referral") },
    { value: "whatsapp", label: tsrc("whatsapp") },
    { value: "walk_in", label: tsrc("walk_in") },
    { value: "social", label: tsrc("social") },
    { value: "facebook", label: tsrc("facebook") },
    { value: "other", label: tsrc("other") },
  ]

  const [form, setForm] = useState<UpdateLeadInput>({
    first_name: lead.first_name,
    last_name: lead.last_name,
    phone: lead.phone,
    phone_alt: lead.phone_alt,
    email: lead.email,
    status: lead.status,
    source: lead.source,
    assigned_rep_id: lead.assigned_rep_id,
    address_line1: lead.address_line1,
    address_line2: lead.address_line2,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    notes: lead.notes,
  })

  function set(key: keyof UpdateLeadInput, value: string | null) {
    setForm((prev) => ({ ...prev, [key]: value || null }))
  }

  function handleSave() {
    // Protección contra pérdida de notas: si el lead TENÍA notas y el form las
    // dejó vacías, pedir confirmación. Evita el caso "rep abre modal, borra sin
    // querer el textarea, guarda, notas perdidas".
    const hadNotes = (lead.notes ?? "").trim().length > 0
    const willClearNotes = !((form.notes ?? "").trim().length > 0)
    if (hadNotes && willClearNotes) {
      const ok = typeof window !== "undefined"
        ? window.confirm("Vas a borrar las notas de este lead. ¿Continuar?")
        : true
      if (!ok) return
    }
    setError(null)
    startTransition(async () => {
      try {
        await updateLead(lead.id, form)
        router.refresh()
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("savingError"))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{t("editLead")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("firstName")} required>
              <Input className={inputCls} value={form.first_name}
                onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))} />
            </Field>
            <Field label={t("lastName")}>
              <Input className={inputCls} value={form.last_name ?? ""}
                onChange={(e) => set("last_name", e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("phone")}>
              <Input className={`${inputCls} font-mono`} value={form.phone ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
            </Field>
            <Field label={t("phoneAlt")}>
              <Input className={`${inputCls} font-mono`} value={form.phone_alt ?? ""}
                onChange={(e) => set("phone_alt", e.target.value)} />
            </Field>
          </div>

          <Field label={t("email")}>
            <Input className={inputCls} type="email" value={form.email ?? ""}
              onChange={(e) => set("email", e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("status")}>
              <Select value={form.status} onValueChange={(v: string) => setForm((p) => ({ ...p, status: v as LeadStatus }))}>
                <SelectTrigger className="h-9 bg-white border-gray-200 text-gray-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-gray-200">
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-gray-800">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("source")}>
              <Select
                value={form.source ?? "none"}
                onValueChange={(v: string) => setForm((p) => ({ ...p, source: v === "none" ? null : v as LeadSource }))}
              >
                <SelectTrigger className="h-9 bg-white border-gray-200 text-gray-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-gray-200">
                  <SelectItem value="none" className="text-gray-400">{tc("none")}</SelectItem>
                  {SOURCE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-gray-800">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {reps.length > 0 && (
            <Field label={t("assignedRep")}>
              <Select
                value={form.assigned_rep_id ?? "none"}
                onValueChange={(v: string) => set("assigned_rep_id", v === "none" ? null : v)}
              >
                <SelectTrigger className="h-9 bg-white border-gray-200 text-gray-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-gray-200">
                  <SelectItem value="none" className="text-gray-400">{tc("none")}</SelectItem>
                  {reps.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="text-gray-800">{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("address")}>
              <Input className={inputCls} value={form.address_line1 ?? ""}
                onChange={(e) => set("address_line1", e.target.value)} />
            </Field>
            <Field label={t("addressLine2")}>
              <Input className={inputCls} value={form.address_line2 ?? ""}
                onChange={(e) => set("address_line2", e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label={t("city")}>
              <Input className={inputCls} value={form.city ?? ""}
                onChange={(e) => set("city", e.target.value)} />
            </Field>
            <Field label={t("state")}>
              <Input className={inputCls} value={form.state ?? ""}
                onChange={(e) => set("state", e.target.value)} />
            </Field>
            <Field label={t("zip")}>
              <Input className={inputCls} value={form.zip ?? ""}
                onChange={(e) => set("zip", e.target.value)} />
            </Field>
          </div>

          <Field label={t("notes")}>
            <textarea
              rows={3}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700 resize-none"
            />
          </Field>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <Button onClick={handleSave} disabled={isPending} className="cursor-pointer" style={{ background: "var(--brand)" }}>
              {isPending ? tc("saving") : tc("save")}
            </Button>
            <Button variant="ghost" className="text-gray-400 hover:text-gray-700" onClick={onClose} disabled={isPending}>
              {tc("cancel")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
