"use client"

import { useRouter } from "next/navigation"
import { useTransition, useState } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createLead } from "../actions"
import { useBrand } from "@/context/brand-context"

const SOURCE_OPTIONS = [
  { value: "inbound_call", label: "Llamada entrante" },
  { value: "web_form", label: "Formulario web" },
  { value: "referral", label: "Referido" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "walk_in", label: "Walk-in" },
  { value: "social", label: "Redes sociales" },
  { value: "other", label: "Otro" },
]

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-400">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

export default function NewLeadPage() {
  const router = useRouter()
  const { activeBrand } = useBrand()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<string>("")

  function handleSubmit(formData: FormData) {
    if (!activeBrand) {
      setError("Selecciona una marca primero")
      return
    }
    formData.set("brand_id", activeBrand.id)
    if (source) formData.set("source", source)

    setError(null)
    startTransition(async () => {
      try {
        const id = await createLead(formData)
        router.push(`/leads/${id}`)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al crear lead")
      }
    })
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">

      {/* Back nav */}
      <div className="flex items-center gap-2">
        <Link
          href="/leads"
          className="text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-lg font-semibold text-zinc-100">Nuevo lead</h1>
      </div>

      {/* Brand indicator */}
      {activeBrand && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: activeBrand.brand_color ?? "#3B82F6" }}
          />
          {activeBrand.name}
        </div>
      )}

      {/* Form */}
      <form action={handleSubmit} className="space-y-4">

        {/* Name row */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre" required>
            <Input
              name="first_name"
              required
              placeholder="Pedro"
              className="bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
            />
          </Field>
          <Field label="Apellido">
            <Input
              name="last_name"
              placeholder="Ramírez"
              className="bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
            />
          </Field>
        </div>

        {/* Phone + Email */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Teléfono" required>
            <Input
              name="phone"
              type="tel"
              required
              placeholder="+52 999 123 4567"
              className="bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600 font-mono"
            />
          </Field>
          <Field label="Email">
            <Input
              name="email"
              type="email"
              placeholder="pedro@mail.com"
              className="bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
            />
          </Field>
        </div>

        {/* Source */}
        <Field label="Fuente">
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="bg-zinc-900 border-zinc-800 text-zinc-300">
              <SelectValue placeholder="¿De dónde viene este lead?" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              {SOURCE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-zinc-200">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* Notes */}
        <Field label="Notas">
          <textarea
            name="notes"
            rows={3}
            placeholder="Contexto inicial, síntomas, interés expresado…"
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700 resize-none"
          />
        </Field>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            type="submit"
            disabled={isPending || !activeBrand}
            className="cursor-pointer"
            style={{ background: "var(--brand)" }}
          >
            {isPending ? "Guardando…" : "Crear lead"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="text-zinc-500 hover:text-zinc-300"
            onClick={() => router.back()}
          >
            Cancelar
          </Button>
        </div>

        {!activeBrand && (
          <p className="text-xs text-zinc-600">
            Selecciona una marca desde el menú para continuar.
          </p>
        )}
      </form>
    </div>
  )
}
