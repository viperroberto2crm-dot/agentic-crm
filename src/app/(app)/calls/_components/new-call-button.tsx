"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createCall } from "../actions"

type Lead = { id: string; first_name: string; last_name: string | null; phone: string }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      {children}
    </div>
  )
}

const inputCls = "bg-white border-gray-200 text-gray-800 placeholder:text-gray-400 h-9"

export function NewCallButton({ brandId, leads }: { brandId: string; leads: Lead[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    lead_id: "none",
    direction: "outbound" as "inbound" | "outbound",
    outcome: "none" as string,
    duration_seconds: "",
    notes: "",
  })

  function handleSave() {
    setError(null)
    startTransition(async () => {
      try {
        await createCall({
          brand_id: brandId,
          lead_id: form.lead_id === "none" ? null : form.lead_id,
          direction: form.direction,
          outcome: form.outcome === "none" ? null : form.outcome as Parameters<typeof createCall>[0]["outcome"],
          duration_seconds: form.duration_seconds ? parseInt(form.duration_seconds) : null,
          notes: form.notes || null,
        })
        router.refresh()
        setOpen(false)
        setForm({ lead_id: "none", direction: "outbound", outcome: "none", duration_seconds: "", notes: "" })
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
        <Phone className="w-3.5 h-3.5" />
        Registrar llamada
      </Button>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Registrar llamada</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Field label="Lead (opcional)">
              <Select value={form.lead_id} onValueChange={(v) => setForm((p) => ({ ...p, lead_id: v }))}>
                <SelectTrigger className="h-9 bg-white border-gray-200 text-gray-700">
                  <SelectValue placeholder="Sin lead" />
                </SelectTrigger>
                <SelectContent className="bg-white border-gray-200 max-h-52 overflow-y-auto">
                  <SelectItem value="none" className="text-gray-400">Sin lead</SelectItem>
                  {leads.map((l) => (
                    <SelectItem key={l.id} value={l.id} className="text-gray-800">
                      {l.first_name} {l.last_name ?? ""} — {l.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Dirección">
                <Select value={form.direction} onValueChange={(v) => setForm((p) => ({ ...p, direction: v as typeof form.direction }))}>
                  <SelectTrigger className="h-9 bg-white border-gray-200 text-gray-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-gray-200">
                    <SelectItem value="outbound" className="text-gray-800">Saliente</SelectItem>
                    <SelectItem value="inbound" className="text-gray-800">Entrante</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Duración (seg)">
                <Input
                  type="number"
                  className={inputCls}
                  placeholder="ej. 120"
                  value={form.duration_seconds}
                  onChange={(e) => setForm((p) => ({ ...p, duration_seconds: e.target.value }))}
                />
              </Field>
            </div>

            <Field label="Resultado">
              <Select value={form.outcome} onValueChange={(v) => setForm((p) => ({ ...p, outcome: v }))}>
                <SelectTrigger className="h-9 bg-white border-gray-200 text-gray-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-gray-200">
                  <SelectItem value="none" className="text-gray-400">Sin resultado</SelectItem>
                  <SelectItem value="connected" className="text-gray-800">Conectado</SelectItem>
                  <SelectItem value="voicemail" className="text-gray-800">Buzón de voz</SelectItem>
                  <SelectItem value="no_answer" className="text-gray-800">Sin respuesta</SelectItem>
                  <SelectItem value="appointment_set" className="text-gray-800">Cita agendada</SelectItem>
                  <SelectItem value="callback_requested" className="text-gray-800">Solicitó devolución</SelectItem>
                  <SelectItem value="not_interested" className="text-gray-800">No interesado</SelectItem>
                  <SelectItem value="wrong_number" className="text-gray-800">Número equivocado</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Notas">
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700 resize-none"
                placeholder="Resumen de la llamada…"
              />
            </Field>

            {error && (
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3 pt-1">
              <Button onClick={handleSave} disabled={isPending} className="cursor-pointer" style={{ background: "var(--brand)" }}>
                {isPending ? "Guardando…" : "Guardar llamada"}
              </Button>
              <Button variant="ghost" className="text-gray-400 hover:text-gray-700" onClick={() => setOpen(false)} disabled={isPending}>
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
