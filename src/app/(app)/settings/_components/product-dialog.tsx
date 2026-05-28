"use client"

import { useState, useEffect, useRef } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { X, Plus, Trash2 } from "lucide-react"

import { Field, inputCls } from "./form-primitives"
import { createProduct, updateProduct, deleteProduct } from "../actions"
import type { Database } from "@/types/database"

type ProductRow = Database["public"]["Tables"]["products"]["Row"]

type Mode = "create" | "edit"

type Props = {
  mode: Mode
  product?: ProductRow
  brandId: string
  categories: string[]
  open: boolean
  onClose: () => void
}

type FormState = {
  name: string
  category: string
  sku: string
  description: string
  price: string
  display_price: string
  display_unit: string
  cadence: "one_time" | "weekly" | "monthly" | "annual"
  recurring: boolean
  best_value: boolean
  active: boolean
  services: string[]
}

function centsToDisplay(cents: number | null): string {
  if (cents === null || cents === 0) return ""
  return (cents / 100).toFixed(2)
}

function displayToCents(val: string): number {
  const n = parseFloat(val.replace(/[^0-9.]/g, ""))
  if (isNaN(n)) return 0
  return Math.round(n * 100)
}

function parseServices(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === "string")
}

function defaultForm(product?: ProductRow): FormState {
  if (!product) {
    return {
      name: "",
      category: "",
      sku: "",
      description: "",
      price: "",
      display_price: "",
      display_unit: "",
      cadence: "monthly",
      recurring: true,
      best_value: false,
      active: true,
      services: [],
    }
  }
  return {
    name: product.name,
    category: product.category,
    sku: product.sku ?? "",
    description: product.description ?? "",
    price: centsToDisplay(product.price_cents),
    display_price: centsToDisplay(product.display_price_cents),
    display_unit: product.display_unit ?? "",
    cadence: (product.cadence as "one_time" | "weekly" | "monthly" | "annual") ?? "monthly",
    recurring: product.recurring,
    best_value: product.best_value,
    active: product.active,
    services: parseServices(product.included_services),
  }
}

export function ProductDialog({ mode, product, brandId, categories, open, onClose }: Props) {
  const t = useTranslations("settings.productDialog")
  const tc = useTranslations("common")
  const router = useRouter()
  const [form, setForm] = useState<FormState>(() => defaultForm(product))
  const [serviceInput, setServiceInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const serviceRef = useRef<HTMLInputElement>(null)

  const CADENCE_LABELS: Record<string, string> = {
    one_time: t("cadenceOneTime"),
    weekly: t("cadenceWeekly"),
    monthly: t("cadenceMonthly"),
    annual: t("cadenceAnnual"),
  }

  useEffect(() => {
    if (open) {
      setForm(defaultForm(product))
      setServiceInput("")
      setError(null)
      setConfirmDelete(false)
    }
  }, [open, product])

  async function handleDelete() {
    if (!product) return
    setLoading(true)
    setError(null)
    try {
      const result = await deleteProduct({ id: product.id, brand_id: brandId })
      if (!result.ok) {
        setError(result.inUse ? t("deleteInUse") : result.error)
        setConfirmDelete(false)
        return
      }
      router.refresh()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"))
    } finally {
      setLoading(false)
    }
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function addService() {
    const val = serviceInput.trim()
    if (!val || form.services.includes(val)) return
    setForm((f) => ({ ...f, services: [...f.services, val] }))
    setServiceInput("")
    serviceRef.current?.focus()
  }

  function removeService(index: number) {
    setForm((f) => ({ ...f, services: f.services.filter((_, i) => i !== index) }))
  }

  async function handleSave() {
    if (!form.name.trim() || !form.category.trim() || !form.price) return
    setLoading(true)
    setError(null)
    try {
      const payload = {
        brand_id: brandId,
        name: form.name.trim(),
        category: form.category.trim(),
        sku: form.sku.trim() || null,
        description: form.description.trim() || null,
        price_cents: displayToCents(form.price),
        display_price_cents: form.display_price ? displayToCents(form.display_price) : null,
        display_unit: form.display_unit.trim() || null,
        cadence: form.cadence,
        recurring: form.recurring,
        best_value: form.best_value,
        active: form.active,
        included_services: form.services,
      }
      const result = mode === "create"
        ? await createProduct(payload)
        : await updateProduct({ ...payload, id: product!.id })

      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"))
    } finally {
      setLoading(false)
    }
  }

  const title = mode === "create" ? t("titleCreate") : t("titleEdit")
  const canSave = form.name.trim() && form.category.trim() && form.price

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

          <Field label={t("category")} required>
            <Input
              className={inputCls}
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              placeholder={categories.length ? t("categoryPlaceholder") : t("categoryPlaceholderEmpty")}
              list="product-categories"
            />
            {categories.length > 0 && (
              <datalist id="product-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("price")} required>
              <Input
                className={inputCls}
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
                placeholder="99.00"
                type="number"
                min="0"
                step="0.01"
              />
            </Field>
            <Field label={t("displayPrice")}>
              <Input
                className={inputCls}
                value={form.display_price}
                onChange={(e) => set("display_price", e.target.value)}
                placeholder="149.00"
                type="number"
                min="0"
                step="0.01"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("cadence")} required>
              <Select
                value={form.cadence}
                onValueChange={(v) => {
                  const next = v as "one_time" | "weekly" | "monthly" | "annual"
                  set("cadence", next)
                  // Si es pago único, forzar recurring=false (no tiene sentido recurring + one_time)
                  if (next === "one_time") set("recurring", false)
                }}
              >
                <SelectTrigger className={inputCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CADENCE_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("displayUnit")}>
              <Input
                className={inputCls}
                value={form.display_unit}
                onChange={(e) => set("display_unit", e.target.value)}
                placeholder={t("displayUnitPlaceholder")}
              />
            </Field>
          </div>

          <Field label={t("sku")}>
            <Input
              className={inputCls}
              value={form.sku}
              onChange={(e) => set("sku", e.target.value)}
              placeholder="PLAN-BASIC-MO"
            />
          </Field>

          <Field label={t("description")}>
            <textarea
              className={`${inputCls} w-full rounded-md border px-3 py-2 text-sm resize-none`}
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder={t("descriptionPlaceholder")}
            />
          </Field>

          {/* Servicios incluidos */}
          <Field label={t("includedServices")}>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  ref={serviceRef}
                  className={`${inputCls} flex-1`}
                  value={serviceInput}
                  onChange={(e) => setServiceInput(e.target.value)}
                  placeholder={t("includedServicesPlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addService()
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addService}
                  disabled={!serviceInput.trim()}
                  className="shrink-0 border-border"
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
              {form.services.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {form.services.map((s, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 text-xs bg-secondary text-foreground border border-border rounded-full px-2.5 py-1"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => removeService(i)}
                        className="text-muted-foreground hover:text-foreground transition-colors ml-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Field>

          {/* Toggles */}
          <div className="space-y-2">
            {(
              [
                { key: "recurring", labelKey: "recurringToggle" },
                { key: "best_value", labelKey: "bestValueToggle" },
                { key: "active", labelKey: "activeToggle" },
              ] as const
            ).map(({ key, labelKey }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(e) => set(key, e.target.checked)}
                  className="accent-primary w-4 h-4"
                />
                <span className="text-sm text-foreground">{t(labelKey)}</span>
              </label>
            ))}
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
                {tc("cancel")}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={loading || !canSave}
              >
                {loading ? tc("saving") : mode === "create" ? tc("create") : tc("save")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
