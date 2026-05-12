"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
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

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "Nuevo" },
  { value: "contacted", label: "Contactado" },
  { value: "qualified", label: "Calificado" },
  { value: "appointment_set", label: "Cita agendada" },
  { value: "sold", label: "Vendido" },
  { value: "lost", label: "Perdido" },
  { value: "on_hold", label: "En pausa" },
]

const SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: "inbound_call", label: "Llamada entrante" },
  { value: "web_form", label: "Formulario web" },
  { value: "referral", label: "Referido" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "walk_in", label: "Walk-in" },
  { value: "social", label: "Redes sociales" },
  { value: "other", label: "Otro" },
]

type LeadData = {
  id: string
  first_name: string
  last_name: string | null
  phone: string
  phone_alt: string | null
  email: string | null
  status: LeadStatus
  source: LeadSource | null
  assigned_rep_id: string | null
  city: string | null
  state: string | null
  notes: string | null
}

type Rep = { id: string; name: string }

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-400">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputCls = "bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600 h-9"

export function EditLeadModal({
  open, onClose, lead, reps,
}: {
  open: boolean
  onClose: () => void
  lead: LeadData
  reps: Rep[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<UpdateLeadInput>({
    first_name: lead.first_name,
    last_name: lead.last_name,
    phone: lead.phone,
    phone_alt: lead.phone_alt,
    email: lead.email,
    status: lead.status,
    source: lead.source,
    assigned_rep_id: lead.assigned_rep_id,
    city: lead.city,
    state: lead.state,
    notes: lead.notes,
  })

  function set(key: keyof UpdateLeadInput, value: string | null) {
    setForm((prev) => ({ ...prev, [key]: value || null }))
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      try {
        await updateLead(lead.id, form)
        router.refresh()
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Editar lead</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Name */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre" required>
              <Input className={inputCls} value={form.first_name}
                onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))} />
            </Field>
            <Field label="Apellido">
              <Input className={inputCls} value={form.last_name ?? ""}
                onChange={(e) => set("last_name", e.target.value)} />
            </Field>
          </div>

          {/* Phone */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Teléfono" required>
              <Input className={`${inputCls} font-mono`} value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
            </Field>
            <Field label="Teléfono alt.">
              <Input className={`${inputCls} font-mono`} value={form.phone_alt ?? ""}
                onChange={(e) => set("phone_alt", e.target.value)} />
            </Field>
          </div>

          {/* Email */}
          <Field label="Email">
            <Input className={inputCls} type="email" value={form.email ?? ""}
              onChange={(e) => set("email", e.target.value)} />
          </Field>

          {/* Status + Source */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <Select value={form.status} onValueChange={(v: string) => setForm((p) => ({ ...p, status: v as LeadStatus }))}>
                <SelectTrigger className="h-9 bg-zinc-900 border-zinc-800 text-zinc-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-zinc-200">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fuente">
              <Select
                value={form.source ?? "none"}
                onValueChange={(v: string) => setForm((p) => ({ ...p, source: v === "none" ? null : v as LeadSource }))}
              >
                <SelectTrigger className="h-9 bg-zinc-900 border-zinc-800 text-zinc-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  <SelectItem value="none" className="text-zinc-500">Sin fuente</SelectItem>
                  {SOURCE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-zinc-200">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Assigned rep (only if reps list provided) */}
          {reps.length > 0 && (
            <Field label="Rep asignado">
              <Select
                value={form.assigned_rep_id ?? "none"}
                onValueChange={(v: string) => set("assigned_rep_id", v === "none" ? null : v)}
              >
                <SelectTrigger className="h-9 bg-zinc-900 border-zinc-800 text-zinc-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  <SelectItem value="none" className="text-zinc-500">Sin asignar</SelectItem>
                  {reps.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="text-zinc-200">{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {/* City + State */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ciudad">
              <Input className={inputCls} value={form.city ?? ""}
                onChange={(e) => set("city", e.target.value)} />
            </Field>
            <Field label="Estado">
              <Input className={inputCls} value={form.state ?? ""}
                onChange={(e) => set("state", e.target.value)} />
            </Field>
          </div>

          {/* Notes */}
          <Field label="Notas">
            <textarea
              rows={3}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700 resize-none"
            />
          </Field>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <Button onClick={handleSave} disabled={isPending} className="cursor-pointer" style={{ background: "var(--brand)" }}>
              {isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
            <Button variant="ghost" className="text-zinc-500 hover:text-zinc-300" onClick={onClose} disabled={isPending}>
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
