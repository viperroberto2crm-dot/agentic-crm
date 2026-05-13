"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateBrand } from "../actions"

const inputCls = "bg-white border-gray-200 text-gray-800 placeholder:text-gray-400 h-9"

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
    </div>
  )
}

export function BrandForm({
  brandId,
  name,
  brandColor,
  logoUrl,
}: {
  brandId: string
  name: string
  brandColor: string | null
  logoUrl: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    name,
    brand_color: brandColor ?? "#6366f1",
    logo_url: logoUrl ?? "",
  })

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        await updateBrand({
          id: brandId,
          name: form.name,
          brand_color: form.brand_color || null,
          logo_url: form.logo_url || null,
        })
        // Update CSS variable immediately
        document.documentElement.style.setProperty("--brand", form.brand_color)
        setSaved(true)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar")
      }
    })
  }

  return (
    <div className="space-y-5 max-w-md">
      <Field label="Nombre de la marca">
        <Input
          className={inputCls}
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
        />
      </Field>

      <Field label="Color de marca" hint="Se aplica a botones, barras y acentos en todo el CRM">
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={form.brand_color}
            onChange={(e) => {
              setForm((p) => ({ ...p, brand_color: e.target.value }))
              document.documentElement.style.setProperty("--brand", e.target.value)
            }}
            className="w-9 h-9 rounded cursor-pointer border border-gray-200 bg-white p-0.5"
          />
          <Input
            className={`${inputCls} font-mono w-36`}
            value={form.brand_color}
            onChange={(e) => {
              setForm((p) => ({ ...p, brand_color: e.target.value }))
              if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                document.documentElement.style.setProperty("--brand", e.target.value)
              }
            }}
          />
          <div
            className="w-9 h-9 rounded border border-gray-300"
            style={{ background: form.brand_color }}
          />
        </div>
      </Field>

      <Field label="URL del logo" hint="URL pública de la imagen (.png, .svg)">
        <Input
          className={inputCls}
          placeholder="https://…"
          value={form.logo_url}
          onChange={(e) => setForm((p) => ({ ...p, logo_url: e.target.value }))}
        />
      </Field>

      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</p>
      )}
      {saved && (
        <p className="text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-3 py-2">
          Marca actualizada
        </p>
      )}

      <Button
        onClick={handleSave}
        disabled={isPending}
        className="cursor-pointer h-9 text-sm"
        style={{ background: "var(--brand)" }}
      >
        {isPending ? "Guardando…" : "Guardar marca"}
      </Button>
    </div>
  )
}
