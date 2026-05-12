"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createAppointment } from "../actions"

type Lead = { id: string; first_name: string; last_name: string | null; phone: string }

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

export function NewAppointmentButton({ brandId, leads }: { brandId: string; leads: Lead[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    lead_id: "",
    type: "clinic" as "clinic" | "home" | "telehealth",
    scheduled_at: "",
    duration_minutes: 30,
    service: "",
    notes: "",
  })

  function handleSave() {
    if (!form.lead_id || !form.scheduled_at) {
      setError("Lead y fecha/hora son requeridos")
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await createAppointment({
          brand_id: brandId,
          lead_id: form.lead_id,
          type: form.type,
          scheduled_at: new Date(form.scheduled_at).toISOString(),
          duration_minutes: form.duration_minutes,
          service: form.service || null,
          notes: form.notes || null,
        })
        router.refresh()
        setOpen(false)
        setForm({ lead_id: "", type: "clinic", scheduled_at: "", duration_minutes: 30, service: "", notes: "" })
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar")
      }
    })
  }

  return (
    <>
      <Button
        size="sm"
        className="h-9 text-xs gap-1.5 cursor-pointer"
        style={{ background: "var(--brand)" }}
        onClick={() => setOpen(true)}
      >
        <Plus className="w-3.5 h-3.5" />
        Nueva cita
      </Button>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Nueva cita</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Field label="Lead" required>
              <Select value={form.lead_id} onValueChange={(v) => setForm((p) => ({ ...p, lead_id: v }))}>
                <SelectTrigger className="h-9 bg-zinc-900 border-zinc-800 text-zinc-300">
                  <SelectValue placeholder="Selecciona un lead…" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800 max-h-52 overflow-y-auto">
                  {leads.map((l) => (
                    <SelectItem key={l.id} value={l.id} className="text-zinc-200">
                      {l.first_name} {l.last_name ?? ""} — {l.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo" required>
                <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v as typeof form.type }))}>
                  <SelectTrigger className="h-9 bg-zinc-900 border-zinc-800 text-zinc-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-800">
                    <SelectItem value="clinic" className="text-zinc-200">Clínica</SelectItem>
                    <SelectItem value="home" className="text-zinc-200">Domicilio</SelectItem>
                    <SelectItem value="telehealth" className="text-zinc-200">Telesalud</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Duración (min)">
                <Input
                  type="number"
                  className={inputCls}
                  value={form.duration_minutes}
                  onChange={(e) => setForm((p) => ({ ...p, duration_minutes: parseInt(e.target.value) || 30 }))}
                />
              </Field>
            </div>

            <Field label="Fecha y hora" required>
              <Input
                type="datetime-local"
                className={`${inputCls} [color-scheme:dark]`}
                value={form.scheduled_at}
                onChange={(e) => setForm((p) => ({ ...p, scheduled_at: e.target.value }))}
              />
            </Field>

            <Field label="Servicio">
              <Input
                className={inputCls}
                placeholder="ej. Consulta inicial"
                value={form.service}
                onChange={(e) => setForm((p) => ({ ...p, service: e.target.value }))}
              />
            </Field>

            <Field label="Notas">
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700 resize-none"
              />
            </Field>

            {error && (
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3 pt-1">
              <Button onClick={handleSave} disabled={isPending} className="cursor-pointer" style={{ background: "var(--brand)" }}>
                {isPending ? "Guardando…" : "Agendar cita"}
              </Button>
              <Button variant="ghost" className="text-zinc-500 hover:text-zinc-300" onClick={() => setOpen(false)} disabled={isPending}>
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
