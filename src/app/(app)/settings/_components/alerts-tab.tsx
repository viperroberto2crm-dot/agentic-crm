"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Plus, Pencil, Trash2, Send, Loader2, CheckCircle2, AlertTriangle } from "lucide-react"
import {
  saveAlertRecipient,
  toggleAlertRecipient,
  deleteAlertRecipient,
  sendTestAlert,
} from "../_actions/alerts-actions"

export type AlertRecipientRow = {
  id: string
  label: string
  channel: string
  email: string | null
  phone: string | null
  brand_ids: string[] | null
  events: string[] | null
  active: boolean
}

export type BrandOption = { id: string; name: string }

type Props = { recipients: AlertRecipientRow[]; brands: BrandOption[] }

const EVENTS: { key: string; label: string; hint: string }[] = [
  { key: "appointment_set", label: "Cita agendada", hint: "El bot o alguien del equipo agenda" },
  { key: "appointment_cancelled", label: "Cita cancelada", hint: "Para liberar el horario" },
  { key: "sale_paid", label: "Pago recibido", hint: "Stripe o Square confirman el cobro" },
  { key: "new_lead", label: "Paciente nuevo sin cita", hint: "Llamó o dejó datos y no agendó" },
]

const EMPTY = {
  label: "",
  channel: "email" as const,
  email: "",
  phone: "",
  brand_ids: [] as string[],
  events: ["appointment_set", "sale_paid"] as string[],
  active: true,
}

export function AlertsTab({ recipients, brands }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: "ok" | "bad"; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  const brandName = (id: string) => brands.find((b) => b.id === id)?.name ?? "—"

  function openNew() {
    setEditId(null)
    setForm({ ...EMPTY })
    setError(null)
    setOpen(true)
  }

  function openEdit(r: AlertRecipientRow) {
    setEditId(r.id)
    setForm({
      label: r.label,
      channel: "email",
      email: r.email ?? "",
      phone: r.phone ?? "",
      brand_ids: r.brand_ids ?? [],
      events: r.events ?? [],
      active: r.active,
    })
    setError(null)
    setOpen(true)
  }

  function toggleIn(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  }

  function save() {
    setError(null)
    startSaving(async () => {
      const res = await saveAlertRecipient(editId, {
        label: form.label,
        channel: "email",
        email: form.email || null,
        phone: form.phone || null,
        brand_ids: form.brand_ids,
        // El type del server action es más estrecho; la validación real es Zod.
        events: form.events as never,
        active: form.active,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  async function onToggle(r: AlertRecipientRow) {
    setBusyId(r.id)
    const res = await toggleAlertRecipient(r.id, !r.active)
    setBusyId(null)
    if (!res.ok) setNotice({ kind: "bad", text: res.error })
    else router.refresh()
  }

  async function onDelete(r: AlertRecipientRow) {
    if (!window.confirm(`¿Quitar a ${r.label} de las alertas?`)) return
    setBusyId(r.id)
    const res = await deleteAlertRecipient(r.id)
    setBusyId(null)
    if (!res.ok) setNotice({ kind: "bad", text: res.error })
    else router.refresh()
  }

  async function onTest(r: AlertRecipientRow) {
    setBusyId(r.id)
    setNotice(null)
    const res = await sendTestAlert(r.id)
    setBusyId(null)
    setNotice(
      res.ok
        ? { kind: "ok", text: `Correo de prueba enviado a ${r.email}. Revisa la bandeja (y spam).` }
        : { kind: "bad", text: res.error },
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#20342C]">Alertas al equipo</h2>
          <p className="text-sm text-[#5C6F68] max-w-prose">
            A quién se le avisa por correo cuando pasa algo en el CRM. Un destinatario sin marcas
            marcadas recibe de <strong>todas</strong>.
          </p>
        </div>
        <Button onClick={openNew} className="shrink-0">
          <Plus className="size-4 mr-1" /> Agregar
        </Button>
      </div>

      {notice && (
        <div
          className={
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm " +
            (notice.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900")
          }
        >
          {notice.kind === "ok" ? (
            <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {recipients.length === 0 ? (
        <p className="text-sm text-[#5C6F68]">
          Todavía no hay nadie. Agrega el primer correo para empezar a recibir avisos.
        </p>
      ) : (
        <ul className="space-y-2">
          {recipients.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-[#ECE3D3] bg-white p-3 flex flex-wrap items-center gap-3"
            >
              <div className="min-w-[12rem] flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[#20342C]">{r.label}</span>
                  {!r.active && (
                    <span className="text-[11px] rounded-full bg-zinc-100 text-zinc-600 px-2 py-0.5">
                      apagado
                    </span>
                  )}
                </div>
                <div className="text-sm text-[#5C6F68]">{r.email ?? r.phone}</div>
                <div className="text-xs text-[#5C6F68] mt-1">
                  {(r.brand_ids ?? []).length === 0
                    ? "Todas las marcas"
                    : (r.brand_ids ?? []).map(brandName).join(" · ")}
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {(r.events ?? []).map((e) => (
                    <span
                      key={e}
                      className="text-[11px] rounded-full border border-[#ECE3D3] px-2 py-0.5 text-[#5C6F68]"
                    >
                      {EVENTS.find((x) => x.key === e)?.label ?? e}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => onTest(r)} disabled={busyId === r.id}>
                  {busyId === r.id ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  <span className="ml-1">Prueba</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onToggle(r)} disabled={busyId === r.id}>
                  {r.active ? "Apagar" : "Prender"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(r)} disabled={busyId === r.id}>
                  <Trash2 className="size-4 text-red-600" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar destinatario" : "Nuevo destinatario"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[#20342C]">Nombre</label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Roberto"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-[#20342C]">Correo</label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="nombre@ejemplo.com"
              />
              <p className="text-xs text-[#5C6F68] mt-1">
                Hoy las alertas salen por correo. El SMS queda pendiente de que Twilio apruebe el A2P.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-[#20342C]">Teléfono (opcional)</label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+15622983012"
              />
            </div>

            <div>
              <span className="text-sm font-medium text-[#20342C]">Eventos</span>
              <div className="mt-1.5 space-y-1.5">
                {EVENTS.map((e) => (
                  <label key={e.key} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={form.events.includes(e.key)}
                      onChange={() => setForm({ ...form, events: toggleIn(form.events, e.key) })}
                    />
                    <span>
                      <span className="text-[#20342C]">{e.label}</span>
                      <span className="block text-xs text-[#5C6F68]">{e.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <span className="text-sm font-medium text-[#20342C]">Marcas</span>
              <p className="text-xs text-[#5C6F68]">Sin marcar ninguna = recibe de todas.</p>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {brands.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.brand_ids.includes(b.id)}
                      onChange={() => setForm({ ...form, brand_ids: toggleIn(form.brand_ids, b.id) })}
                    />
                    <span className="text-[#20342C]">{b.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="size-4 mr-1 animate-spin" />}
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
