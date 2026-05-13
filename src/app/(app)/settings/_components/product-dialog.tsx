"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
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
import { X, Plus } from "lucide-react"
import { Field, inputCls } from "./form-primitives"
import { createProduct, updateProduct } from "../actions"
import type { Database } from "@/types/database"

type ProductRow = Database["public"]["Tables"]["products"]["Row"]

type Mode = "create" | "edit"

type Props = {
  mode: Mode
  product?: ProductRow
  brandId: string
  categories: string[]
  productNames: string[]
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
  cadence: "weekly" | "monthly" | "annual"
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
    cadence: (product.cadence as "weekly" | "monthly" | "annual") ?? "monthly",
    recurring: product.recurring,
    best_value: product.best_value,
    active: product.active,
    services: parseServices(product.included_services),
  }
}

const CADENCE_LABELS: Record<string, string> = {
  weekly: "Semanal",
  monthly: "Mensual",
  annual: "Anual",
}

export function ProductDialog({ mode, product, brandId, categories, productNames, open, onClose }: Props) {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(() => defaultForm(product))
  const [serviceInput, setServiceInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const serviceRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setForm(defaultForm(product))
      setServiceInput("")
      setError(null)
    }
  }, [open, product])

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
      setError(e instanceof Error ? e.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  const title = mode === "create" ? "Nuevo producto" : "Editar producto"
  const canSave = form.name.trim() && form.category.trim() && form.price

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="light-surface max-w-md bg-white border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <Field label="Nombre" required>
            {productNames.length > 0 && form.name !== "__custom__" ? (
              <>
                <Select
                  value={form.name}
                  onValueChange={(v) => {
                    if (v === "__custom__") set("name", "")
                    else set("name", v)
                  }}
                >
                  <SelectTrigger className={inputCls}>
                    <SelectValue placeholder="Selecciona un nombre…" />
                  </SelectTrigger>
                  <SelectContent>
                    {productNames.map((n) => (
                      <SelectItem key={n} value={n}>{n}</SelectItem>
                    ))}
                    <SelectItem value="__custom__">✏️ Escribir otro…</SelectItem>
                  </SelectContent>
                </Select>
              </>
            ) : (
              <div className="flex gap-2">
                <Input
                  className={`${inputCls} flex-1`}
                  value={form.name === "__custom__" ? "" : form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Escribe el nombre del producto…"
                  onKeyDown={(e) => e.key === "Enter" && canSave && handleSave()}
                  autoFocus
                />
                {productNames.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 border-border text-xs"
                    onClick={() => set("name", productNames[0])}
                  >
                    ← Lista
                  </Button>
                )}
              </div>
            )}
          </Field>

          <Field label="Categoría" required>
            <Input
              className={inputCls}
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              placeholder={categories.length ? "Elige o escribe nueva…" : "Suscripción, Botox, Medicamentos…"}
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
            <Field label="Precio (USD)" required>
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
            <Field label="Precio tachado (USD)">
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
            <Field label="Cadencia" required>
              <Select
                value={form.cadence}
                onValueChange={(v) => set("cadence", v as "weekly" | "monthly" | "annual")}
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
            <Field label="Unidad de display">
              <Input
                className={inputCls}
                value={form.display_unit}
                onChange={(e) => set("display_unit", e.target.value)}
                placeholder="mes, año…"
              />
            </Field>
          </div>

          <Field label="SKU">
            <Input
              className={inputCls}
              value={form.sku}
              onChange={(e) => set("sku", e.target.value)}
              placeholder="PLAN-BASIC-MO"
            />
          </Field>

          <Field label="Descripción">
            <textarea
              className={`${inputCls} w-full rounded-md border px-3 py-2 text-sm resize-none`}
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Descripción breve del producto…"
            />
          </Field>

          {/* Servicios incluidos */}
          <Field label="Servicios incluidos">
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  ref={serviceRef}
                  className={`${inputCls} flex-1`}
                  value={serviceInput}
                  onChange={(e) => setServiceInput(e.target.value)}
                  placeholder="Botox, Consulta médica, Medicamentos…"
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
                { key: "recurring", label: "Pago recurrente" },
                { key: "best_value", label: "Destacar como mejor valor" },
                { key: "active", label: "Activo" },
              ] as const
            ).map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(e) => set(key, e.target.checked)}
                  className="accent-primary w-4 h-4"
                />
                <span className="text-sm text-foreground">{label}</span>
              </label>
            ))}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={loading || !canSave}
            >
              {loading ? "Guardando…" : mode === "create" ? "Crear" : "Guardar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
