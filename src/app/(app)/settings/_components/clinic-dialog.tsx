"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Trash2 } from "lucide-react"

import { Field, inputCls } from "./form-primitives"
import { createClinic, updateClinic, deleteClinic } from "../actions"
import type { Database } from "@/types/database"

type ClinicRow = Database["public"]["Tables"]["clinics"]["Row"]

type Mode = "create" | "edit"

type Props = {
  mode: Mode
  clinic?: ClinicRow
  brandId: string
  open: boolean
  onClose: () => void
}

type FormState = {
  name: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  zip: string
  phone: string
  active: boolean
}

function defaultForm(clinic?: ClinicRow): FormState {
  if (!clinic) {
    return {
      name: "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      zip: "",
      phone: "",
      active: true,
    }
  }
  return {
    name: clinic.name,
    address_line1: clinic.address_line1 ?? "",
    address_line2: clinic.address_line2 ?? "",
    city: clinic.city ?? "",
    state: clinic.state ?? "",
    zip: clinic.zip ?? "",
    phone: clinic.phone ?? "",
    active: clinic.active,
  }
}

export function ClinicDialog({ mode, clinic, brandId, open, onClose }: Props) {
  const router = useRouter()
  const t = useTranslations("clinics")
  const tCommon = useTranslations("common")
  const [form, setForm] = useState<FormState>(() => defaultForm(clinic))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(defaultForm(clinic))
      setError(null)
      setConfirmDelete(false)
    }
  }, [open, clinic])

  async function handleDelete() {
    if (!clinic) return
    setLoading(true)
    setError(null)
    try {
      const result = await deleteClinic({ id: clinic.id, brand_id: brandId })
      if (!result.ok) {
        setError(result.inUse ? t("deleteInUse") : result.error)
        setConfirmDelete(false)
        return
      }
      router.refresh()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setLoading(true)
    setError(null)
    try {
      const payload = {
        brand_id: brandId,
        name: form.name.trim(),
        address_line1: form.address_line1.trim() || null,
        address_line2: form.address_line2.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip: form.zip.trim() || null,
        phone: form.phone.trim() || null,
        active: form.active,
      }
      const result =
        mode === "create"
          ? await createClinic(payload)
          : await updateClinic({ ...payload, id: clinic!.id })

      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  const title = mode === "create" ? t("newClinic") : t("editClinic")
  const canSave = !!form.name.trim()

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="light-surface max-w-md bg-white border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <Field label={t("name")} required>
            <Input
              className={inputCls}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={t("namePlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && canSave && handleSave()}
              autoFocus
            />
          </Field>

          <Field label={t("addressLine1")}>
            <Input
              className={inputCls}
              value={form.address_line1}
              onChange={(e) => set("address_line1", e.target.value)}
              placeholder="123 Main St"
            />
          </Field>

          <Field label={t("addressLine2")}>
            <Input
              className={inputCls}
              value={form.address_line2}
              onChange={(e) => set("address_line2", e.target.value)}
              placeholder="Suite 200"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("city")}>
              <Input
                className={inputCls}
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                placeholder="Miami"
              />
            </Field>
            <Field label={t("state")}>
              <Input
                className={inputCls}
                value={form.state}
                onChange={(e) => set("state", e.target.value)}
                placeholder="FL"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("zip")}>
              <Input
                className={inputCls}
                value={form.zip}
                onChange={(e) => set("zip", e.target.value)}
                placeholder="33101"
              />
            </Field>
            <Field label={t("phone")}>
              <Input
                className={inputCls}
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+1 305 555 0100"
              />
            </Field>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set("active", e.target.checked)}
                className="accent-primary w-4 h-4"
              />
              <span className="text-sm text-foreground">{t("active")}</span>
            </label>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex items-center justify-between gap-2 pt-1">
            {mode === "edit" ? (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-500">{t("confirmDeleteQuestion")}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-red-500 hover:bg-red-50 hover:text-red-600"
                    onClick={handleDelete}
                    disabled={loading}
                  >
                    {loading ? t("deleting") : t("confirmDeleteBtn")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => setConfirmDelete(false)}
                    disabled={loading}
                  >
                    {t("deleteNo")}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground hover:text-red-500 hover:bg-red-50 gap-1.5"
                  onClick={() => setConfirmDelete(true)}
                  disabled={loading}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t("deleteBtn")}
                </Button>
              )
            ) : <span />}

            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
                {tCommon("cancel")}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={loading || !canSave}>
                {loading ? tCommon("saving") : mode === "create" ? tCommon("create") : tCommon("save")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
