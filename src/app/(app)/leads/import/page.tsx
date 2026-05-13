"use client"

import { useState, useCallback, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import * as XLSX from "xlsx"
import { ArrowLeft, Upload, Download, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { importLeads, type ImportRow } from "./actions"
import { useBrand } from "@/context/brand-context"

// ── Types ────────────────────────────────────────────────────────────────────

type Step = "upload" | "map" | "preview" | "importing" | "done"

type RawRow = Record<string, string>

type FieldMapping = {
  field: keyof ImportRow | null
  header: string
}

const LEAD_FIELDS: { value: keyof ImportRow; label: string; required?: boolean }[] = [
  { value: "first_name", label: "Nombre", required: true },
  { value: "last_name", label: "Apellido" },
  { value: "phone", label: "Teléfono", required: true },
  { value: "email", label: "Email" },
  { value: "source", label: "Fuente" },
  { value: "notes", label: "Notas" },
  { value: "city", label: "Ciudad" },
  { value: "state", label: "Estado" },
]

// Auto-match Excel header → lead field
const AUTO_MATCH: Record<string, keyof ImportRow> = {
  "first name": "first_name", nombre: "first_name", "primer nombre": "first_name",
  "last name": "last_name", apellido: "last_name",
  phone: "phone", teléfono: "phone", telefono: "phone", tel: "phone", celular: "phone",
  email: "email", correo: "email",
  source: "source", fuente: "source",
  notes: "notes", notas: "notes", comentarios: "notes",
  city: "city", ciudad: "city",
  state: "state", estado: "state",
}

function autoMatch(header: string): keyof ImportRow | null {
  return AUTO_MATCH[header.toLowerCase().trim()] ?? null
}

// ── Download template ─────────────────────────────────────────────────────────

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ["First Name", "Last Name", "Phone", "Email", "Source", "Notes", "City", "State"],
    ["Pedro", "Ramírez", "+5219991234567", "pedro@mail.com", "whatsapp", "", "Mérida", "Yucatán"],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Leads")
  XLSX.writeFile(wb, "plantilla_leads.xlsx")
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateRow(row: ImportRow, idx: number): string | null {
  if (!row.first_name?.trim()) return `Fila ${idx + 1}: nombre vacío`
  if (!row.phone?.trim() || row.phone.trim().length < 6) return `Fila ${idx + 1}: teléfono inválido`
  if (row.email && row.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))
    return `Fila ${idx + 1}: email inválido`
  return null
}

// ── Step components ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "Subir" },
    { key: "map", label: "Mapear" },
    { key: "preview", label: "Revisar" },
    { key: "done", label: "Listo" },
  ]
  const order: Step[] = ["upload", "map", "preview", "importing", "done"]
  const current = order.indexOf(step)

  return (
    <div className="flex items-center gap-1 text-xs">
      {steps.map((s, i) => {
        const idx = order.indexOf(s.key)
        const done = idx < current
        const active = idx === current || (step === "importing" && s.key === "preview")
        return (
          <span key={s.key} className="flex items-center gap-1">
            {i > 0 && <span className="text-gray-300 mx-1">›</span>}
            <span className={done ? "text-gray-500" : active ? "text-gray-900 font-medium" : "text-gray-300"}>
              {s.label}
            </span>
          </span>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ImportLeadsPage() {
  const router = useRouter()
  const { activeBrand } = useBrand()
  const [isPending, startTransition] = useTransition()

  const [step, setStep] = useState<Step>("upload")
  const [rawRows, setRawRows] = useState<RawRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mappings, setMappings] = useState<FieldMapping[]>([])
  const [previewRows, setPreviewRows] = useState<ImportRow[]>([])
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [skipErrors, setSkipErrors] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: Array<{ row: number; message: string }> } | null>(null)

  // ── File parsing ─────────────────────────────────────────────────────────

  function parseFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      alert("Archivo mayor a 10MB. Reduce el tamaño e intenta de nuevo.")
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer)
      const wb = XLSX.read(data, { type: "array" })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: "" })

      if (rows.length === 0) { alert("El archivo está vacío."); return }

      const hdrs = Object.keys(rows[0])
      setHeaders(hdrs)
      setRawRows(rows)
      setMappings(hdrs.map((h) => ({ header: h, field: autoMatch(h) })))
      setStep("map")
    }
    reader.readAsArrayBuffer(file)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }, [])

  // ── Build preview ─────────────────────────────────────────────────────────

  function buildPreview() {
    const mapped = rawRows.map((row) => {
      const lead: Record<string, string | null> = {
        first_name: null, last_name: null, phone: null, email: null,
        source: null, notes: null, city: null, state: null,
      }
      mappings.forEach(({ header, field }) => {
        if (field) lead[field] = row[header] != null ? String(row[header]).trim() || null : null
      })
      return lead as unknown as ImportRow
    })

    const errors: string[] = []
    mapped.forEach((row, i) => {
      const err = validateRow(row, i)
      if (err) errors.push(err)
    })

    setPreviewRows(mapped)
    setValidationErrors(errors)
    setStep("preview")
  }

  // ── Import ────────────────────────────────────────────────────────────────

  function handleImport() {
    if (!activeBrand) { alert("Selecciona una marca primero"); return }

    const toImport = skipErrors
      ? previewRows.filter((_, i) => !validationErrors.some((e) => e.startsWith(`Fila ${i + 1}:`)))
      : previewRows

    setStep("importing")
    startTransition(async () => {
      try {
        const result = await importLeads(toImport, activeBrand.id, null)
        setImportResult(result)
        setStep("done")
      } catch (e) {
        alert(e instanceof Error ? e.message : "Error al importar")
        setStep("preview")
      }
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link href="/leads" className="text-gray-400 hover:text-gray-500 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">Importar leads</h1>
        </div>
        <StepIndicator step={step} />
      </div>

      {/* Brand indicator */}
      {activeBrand && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="w-2 h-2 rounded-full" style={{ background: activeBrand.brand_color ?? "#3B82F6" }} />
          {activeBrand.name}
        </div>
      )}

      {/* ── STEP: UPLOAD ── */}
      {step === "upload" && (
        <div className="space-y-4">
          {/* Drag-drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
              dragOver ? "border-zinc-500 bg-gray-50" : "border-gray-200 hover:border-gray-300 hover:bg-white"
            }`}
            onClick={() => document.getElementById("file-input")?.click()}
          >
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            <p className="text-sm text-gray-500 font-medium">Arrastra tu archivo aquí</p>
            <p className="text-xs text-gray-400 mt-1">o haz click para seleccionar</p>
            <p className="text-[11px] text-gray-300 mt-3">Acepta .xlsx y .csv · Máximo 10 MB</p>
            <input
              id="file-input"
              type="file"
              accept=".xlsx,.csv,.xls"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f) }}
            />
          </div>

          {/* Download template */}
          <div className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg">
            <div>
              <p className="text-sm text-gray-700 font-medium">Plantilla Excel</p>
              <p className="text-xs text-gray-400">Descarga el formato con las columnas correctas</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-gray-300 text-gray-700 hover:text-gray-900 cursor-pointer"
              onClick={downloadTemplate}
            >
              <Download className="w-3.5 h-3.5" />
              Descargar
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP: MAP ── */}
      {step === "map" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Archivo cargado con <strong className="text-gray-800">{rawRows.length}</strong> filas y{" "}
            <strong className="text-gray-800">{headers.length}</strong> columnas.
            Asigna cada columna del Excel a un campo del lead.
          </p>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest px-4 py-2.5">Columna del archivo</th>
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest px-4 py-2.5">Campo del lead</th>
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest px-4 py-2.5">Muestra</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m, i) => (
                  <tr key={m.header} className="border-b border-gray-100">
                    <td className="px-4 py-2.5 text-gray-700 font-mono text-xs">{m.header}</td>
                    <td className="px-4 py-2.5">
                      <Select
                        value={m.field ?? "skip"}
                        onValueChange={(v: string) =>
                          setMappings((prev) => prev.map((x, j) =>
                            j === i ? { ...x, field: v === "skip" ? null : v as keyof ImportRow } : x
                          ))
                        }
                      >
                        <SelectTrigger className="h-8 bg-white border-gray-200 text-gray-700 text-xs w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-gray-200">
                          <SelectItem value="skip" className="text-gray-400 text-xs">— Omitir —</SelectItem>
                          {LEAD_FIELDS.map((f) => (
                            <SelectItem key={f.value} value={f.value} className="text-gray-800 text-xs">
                              {f.label}{f.required ? " *" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400 truncate max-w-[140px]">
                      {String(rawRows[0]?.[m.header] ?? "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <Button onClick={buildPreview} className="cursor-pointer" style={{ background: "var(--brand)" }}>
              Ver preview →
            </Button>
            <Button variant="ghost" className="text-gray-400" onClick={() => setStep("upload")}>
              ← Volver
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP: PREVIEW ── */}
      {step === "preview" && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-700">
              <strong className="text-gray-900">{previewRows.length}</strong> filas listas para importar
            </span>
            {validationErrors.length > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertCircle className="w-3.5 h-3.5" />
                {validationErrors.length} con error{validationErrors.length !== 1 ? "es" : ""}
              </span>
            )}
          </div>

          {/* Preview table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest px-3 py-2">#</th>
                  {LEAD_FIELDS.filter((f) => mappings.some((m) => m.field === f.value)).map((f) => (
                    <th key={f.value} className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest px-3 py-2">
                      {f.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 10).map((row, i) => {
                  const rowErr = validationErrors.find((e) => e.startsWith(`Fila ${i + 1}:`))
                  return (
                    <tr key={i} className={`border-b border-gray-100 ${rowErr ? "bg-red-400/5" : ""}`}>
                      <td className="px-3 py-2 text-[10px] text-gray-300 tabular-nums">{i + 1}</td>
                      {LEAD_FIELDS.filter((f) => mappings.some((m) => m.field === f.value)).map((f) => (
                        <td key={f.value} className="px-3 py-2 text-xs text-gray-700 truncate max-w-[120px]">
                          {String(row[f.value] ?? "—")}
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        {rowErr && (
                          <span title={rowErr}>
                            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {previewRows.length > 10 && (
              <p className="text-[11px] text-gray-300 px-3 py-2">
                +{previewRows.length - 10} filas más no mostradas
              </p>
            )}
          </div>

          {/* Validation errors list */}
          {validationErrors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500">Errores encontrados:</p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {validationErrors.slice(0, 20).map((err, i) => (
                  <p key={i} className="text-xs text-red-400 flex items-start gap-1.5">
                    <X className="w-3 h-3 mt-0.5 shrink-0" />
                    {err}
                  </p>
                ))}
                {validationErrors.length > 20 && (
                  <p className="text-xs text-gray-400">+{validationErrors.length - 20} más…</p>
                )}
              </div>

              {/* Skip vs cancel */}
              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipErrors}
                    onChange={(e) => setSkipErrors(e.target.checked)}
                    className="accent-zinc-400"
                  />
                  Saltar filas con errores e importar las válidas
                </label>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              onClick={handleImport}
              disabled={isPending || (!skipErrors && validationErrors.length > 0)}
              className="gap-2 cursor-pointer"
              style={{ background: "var(--brand)" }}
            >
              {isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Importando…</>
              ) : (
                `Importar ${skipErrors ? previewRows.length - validationErrors.length : previewRows.length} leads`
              )}
            </Button>
            <Button variant="ghost" className="text-gray-400" onClick={() => setStep("map")}>
              ← Volver
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP: IMPORTING ── */}
      {step === "importing" && (
        <div className="flex flex-col items-center gap-4 py-16">
          <Loader2 className="w-8 h-8 text-gray-500 animate-spin" />
          <p className="text-sm text-gray-500">Importando leads…</p>
        </div>
      )}

      {/* ── STEP: DONE ── */}
      {step === "done" && importResult && (
        <div className="space-y-6">
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <p className="text-xl font-semibold text-gray-900">
              {importResult.imported > 0
                ? `Importados ${importResult.imported} lead${importResult.imported !== 1 ? "s" : ""}`
                : "Sin leads importados"}
            </p>
            {importResult.skipped > 0 && (
              <p className="text-sm text-gray-400">
                {importResult.skipped} saltado{importResult.skipped !== 1 ? "s" : ""} por errores
              </p>
            )}
          </div>

          {importResult.errors.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
              <p className="text-xs font-medium text-gray-500">Filas con error:</p>
              {importResult.errors.slice(0, 10).map((err, i) => (
                <p key={i} className="text-xs text-red-400">Fila {err.row}: {err.message}</p>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={() => router.push("/leads")}
              className="cursor-pointer"
              style={{ background: "var(--brand)" }}
            >
              Ver leads importados
            </Button>
            <Button
              variant="ghost"
              className="text-gray-400"
              onClick={() => {
                setStep("upload")
                setRawRows([])
                setHeaders([])
                setMappings([])
                setPreviewRows([])
                setValidationErrors([])
                setImportResult(null)
              }}
            >
              Importar otro archivo
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
