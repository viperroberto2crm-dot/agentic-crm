"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createTask } from "../actions"
import type { Database } from "@/types/database"

type TaskPriority = Database["public"]["Enums"]["task_priority"]
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

export function NewTaskButton({
  brandId,
  reps,
  currentUserId,
}: {
  brandId: string | null
  reps: Rep[]
  currentUserId: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "normal" as TaskPriority,
    due_at: "",
    assigned_to: currentUserId,
  })

  function handleSave() {
    if (!form.title.trim()) {
      setError("El título es requerido")
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await createTask({
          brand_id: brandId,
          title: form.title,
          description: form.description || null,
          priority: form.priority,
          due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
          assigned_to: form.assigned_to || null,
          related_lead_id: null,
        })
        router.refresh()
        setOpen(false)
        setForm({ title: "", description: "", priority: "normal", due_at: "", assigned_to: currentUserId })
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
        Nueva tarea
      </Button>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Nueva tarea</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Field label="Título" required>
              <Input
                className={inputCls}
                placeholder="Describe la tarea…"
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Prioridad">
                <Select value={form.priority} onValueChange={(v) => setForm((p) => ({ ...p, priority: v as TaskPriority }))}>
                  <SelectTrigger className="h-9 bg-zinc-900 border-zinc-800 text-zinc-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-800">
                    <SelectItem value="urgent" className="text-red-400">Urgente</SelectItem>
                    <SelectItem value="high" className="text-orange-400">Alta</SelectItem>
                    <SelectItem value="normal" className="text-zinc-200">Normal</SelectItem>
                    <SelectItem value="low" className="text-zinc-500">Baja</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Vence">
                <Input
                  type="datetime-local"
                  className={`${inputCls} [color-scheme:dark]`}
                  value={form.due_at}
                  onChange={(e) => setForm((p) => ({ ...p, due_at: e.target.value }))}
                />
              </Field>
            </div>

            {reps.length > 0 && (
              <Field label="Asignar a">
                <Select value={form.assigned_to} onValueChange={(v) => setForm((p) => ({ ...p, assigned_to: v }))}>
                  <SelectTrigger className="h-9 bg-zinc-900 border-zinc-800 text-zinc-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-800">
                    {reps.map((r) => (
                      <SelectItem key={r.id} value={r.id} className="text-zinc-200">{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <Field label="Descripción">
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700 resize-none"
                placeholder="Detalles opcionales…"
              />
            </Field>

            {error && (
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3 pt-1">
              <Button onClick={handleSave} disabled={isPending} className="cursor-pointer" style={{ background: "var(--brand)" }}>
                {isPending ? "Guardando…" : "Crear tarea"}
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
