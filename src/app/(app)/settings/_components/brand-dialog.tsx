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

import { Field, inputCls } from "./form-primitives"
import { createBrand, updateBrandFull } from "../actions"
import type { Database } from "@/types/database"

type BrandRow = Database["public"]["Tables"]["brands"]["Row"]

type Mode = "create" | "edit"

type Props = {
  mode: Mode
  brand?: BrandRow
  open: boolean
  onClose: () => void
}

type FormState = {
  name: string
  slug: string
  slugTouched: boolean
  brand_color: string
  logo_url: string
  reply_email: string
  whatsapp_number: string
  active: boolean
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
}

function defaultForm(brand?: BrandRow): FormState {
  if (!brand) {
    return {
      name: "",
      slug: "",
      slugTouched: false,
      brand_color: "#6366f1",
      logo_url: "",
      reply_email: "",
      whatsapp_number: "",
      active: true,
    }
  }
  return {
    name: brand.name,
    slug: brand.slug,
    slugTouched: true, // existente: no auto-regenerar
    brand_color: brand.brand_color ?? "#6366f1",
    logo_url: brand.logo_url ?? "",
    reply_email: brand.reply_email ?? "",
    whatsapp_number: brand.whatsapp_number ?? "",
    active: brand.active,
  }
}

export function BrandDialog({ mode, brand, open, onClose }: Props) {
  const router = useRouter()
  const t = useTranslations("brands")
  const tCommon = useTranslations("common")
  const [form, setForm] = useState<FormState>(() => defaultForm(brand))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(defaultForm(brand))
      setError(null)
    }
  }, [open, brand])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleNameChange(value: string) {
    setForm((f) => ({
      ...f,
      name: value,
      // Auto-genera el slug mientras el usuario no lo haya tocado a mano
      slug: f.slugTouched ? f.slug : slugify(value),
    }))
  }

  function handleSlugChange(value: string) {
    setForm((f) => ({
      ...f,
      slug: value,
      slugTouched: true,
    }))
  }

  async function handleSave() {
    if (!form.name.trim() || !form.slug.trim()) return
    setLoading(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        brand_color: form.brand_color.trim() || null,
        logo_url: form.logo_url.trim() || null,
        reply_email: form.reply_email.trim() || null,
        whatsapp_number: form.whatsapp_number.trim() || null,
        active: form.active,
      }
      const result =
        mode === "create"
          ? await createBrand(payload)
          : await updateBrandFull({ ...payload, id: brand!.id })

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

  const title = mode === "create" ? t("newBrand") : t("editBrand")
  const canSave = !!form.name.trim() && !!form.slug.trim()

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
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Acme Wellness"
              autoFocus
            />
          </Field>

          <Field label={t("slug")} required>
            <Input
              className={`${inputCls} font-mono`}
              value={form.slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="acme-wellness"
            />
            <p className="text-[11px] text-muted-foreground mt-1">{t("slugHint")}</p>
          </Field>

          <Field label={t("color")}>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.brand_color}
                onChange={(e) => set("brand_color", e.target.value)}
                className="w-9 h-9 rounded cursor-pointer border border-border bg-white p-0.5"
              />
              <Input
                className={`${inputCls} font-mono w-36`}
                value={form.brand_color}
                onChange={(e) => set("brand_color", e.target.value)}
                placeholder="#6366f1"
              />
              <div
                className="w-9 h-9 rounded border border-border"
                style={{ background: form.brand_color }}
                aria-hidden
              />
            </div>
          </Field>

          <Field label={t("logoUrl")}>
            <Input
              className={inputCls}
              value={form.logo_url}
              onChange={(e) => set("logo_url", e.target.value)}
              placeholder="https://…"
            />
          </Field>

          <Field label={t("replyEmail")}>
            <Input
              className={inputCls}
              type="email"
              value={form.reply_email}
              onChange={(e) => set("reply_email", e.target.value)}
              placeholder="hola@acme.com"
            />
          </Field>

          <Field label={t("whatsapp")}>
            <Input
              className={inputCls}
              value={form.whatsapp_number}
              onChange={(e) => set("whatsapp_number", e.target.value)}
              placeholder="+1 305 555 0100"
            />
          </Field>

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

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
              {tCommon("cancel")}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={loading || !canSave}>
              {loading ? tCommon("saving") : mode === "create" ? tCommon("create") : tCommon("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
