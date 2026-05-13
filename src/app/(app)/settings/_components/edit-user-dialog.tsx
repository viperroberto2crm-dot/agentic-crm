"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { updateUser } from "../actions"
import { Field, inputCls } from "./form-primitives"
import type { UserRow } from "./users-tab"

type Props = {
  open: boolean
  onClose: () => void
  user: UserRow
  brandId: string
  currentUserId: string
}

export function EditUserDialog({ open, onClose, user, brandId, currentUserId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: user.name,
    role: user.role,
    active: user.active,
  })

  const isSelf = user.id === currentUserId

  function handleClose() {
    setError(null)
    onClose()
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      try {
        await updateUser({ id: user.id, name: form.name, role: form.role, active: form.active, brand_id: brandId })
        router.refresh()
        handleClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-white border-border text-foreground max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Editar usuario</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <Field label="Email">
            <Input
              className={`${inputCls} opacity-50 cursor-not-allowed`}
              value={user.email}
              disabled
            />
          </Field>

          <Field label="Nombre completo">
            <Input
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </Field>

          <Field label="Rol">
            <Select
              value={form.role}
              onValueChange={(v) => setForm((p) => ({ ...p, role: v as typeof form.role }))}
            >
              <SelectTrigger className="h-9 bg-white border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-border">
                <SelectItem value="rep" className="text-foreground">Rep de ventas</SelectItem>
                <SelectItem value="manager" className="text-foreground">Manager</SelectItem>
                <SelectItem value="admin" className="text-foreground">Admin</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Estado">
            <Select
              value={form.active ? "active" : "inactive"}
              onValueChange={(v) => setForm((p) => ({ ...p, active: v === "active" }))}
              disabled={isSelf}
            >
              <SelectTrigger className="h-9 bg-white border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-border">
                <SelectItem value="active" className="text-foreground">Activo</SelectItem>
                <SelectItem value="inactive" className="text-foreground">Inactivo</SelectItem>
              </SelectContent>
            </Select>
            {isSelf && (
              <p className="text-[11px] text-muted-foreground mt-1">No puedes desactivar tu propia cuenta</p>
            )}
          </Field>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <Button
              onClick={handleSave}
              disabled={isPending || !form.name}
              className="cursor-pointer h-9 text-sm"
              style={{ background: "var(--brand)" }}
            >
              {isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={handleClose}
              disabled={isPending}
            >
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
