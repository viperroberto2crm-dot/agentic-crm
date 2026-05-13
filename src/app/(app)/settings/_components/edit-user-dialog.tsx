"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Trash2 } from "lucide-react"
import { updateUser, deleteUser } from "../actions"
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
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleClose() {
    setError(null)
    setConfirmDelete(false)
    onClose()
  }

  function handleDelete() {
    setError(null)
    startTransition(async () => {
      try {
        await deleteUser(user.id, brandId)
        router.refresh()
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al eliminar")
        setConfirmDelete(false)
      }
    })
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
      <DialogContent className="light-surface bg-white border-border text-foreground max-w-md max-h-[90vh] overflow-y-auto">
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

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex gap-3">
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

            {!isSelf && (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-500">¿Eliminar definitivamente?</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-red-500 hover:bg-red-50 hover:text-red-600"
                    onClick={handleDelete}
                    disabled={isPending}
                  >
                    {isPending ? "Eliminando…" : "Sí, eliminar"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => setConfirmDelete(false)}
                    disabled={isPending}
                  >
                    No
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground hover:text-red-500 hover:bg-red-50 gap-1.5"
                  onClick={() => setConfirmDelete(true)}
                  disabled={isPending}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Eliminar
                </Button>
              )
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
