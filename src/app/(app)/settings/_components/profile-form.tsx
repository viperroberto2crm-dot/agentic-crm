"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateProfile } from "../actions"

const inputCls = "bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600 h-9"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-400">{label}</label>
      {children}
    </div>
  )
}

export function ProfileForm({
  name,
  email,
  cellPhone,
}: {
  name: string
  email: string
  cellPhone: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({ name, cell_phone: cellPhone ?? "" })

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        await updateProfile({ name: form.name, cell_phone: form.cell_phone || null })
        setSaved(true)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar")
      }
    })
  }

  return (
    <div className="space-y-5 max-w-md">
      <Field label="Nombre">
        <Input
          className={inputCls}
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
        />
      </Field>

      <Field label="Email">
        <Input
          className={`${inputCls} opacity-50 cursor-not-allowed`}
          value={email}
          disabled
        />
        <p className="text-[11px] text-zinc-600 mt-1">El email se gestiona a través de Supabase Auth</p>
      </Field>

      <Field label="Teléfono celular">
        <Input
          className={`${inputCls} font-mono`}
          placeholder="+52 555 000 0000"
          value={form.cell_phone}
          onChange={(e) => setForm((p) => ({ ...p, cell_phone: e.target.value }))}
        />
      </Field>

      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</p>
      )}
      {saved && (
        <p className="text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-3 py-2">
          Perfil actualizado
        </p>
      )}

      <Button
        onClick={handleSave}
        disabled={isPending}
        className="cursor-pointer h-9 text-sm"
        style={{ background: "var(--brand)" }}
      >
        {isPending ? "Guardando…" : "Guardar cambios"}
      </Button>
    </div>
  )
}
