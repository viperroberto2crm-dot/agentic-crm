"use client"

import { useState, useCallback, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useTranslations } from "next-intl"
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

// Auto-match Excel/CSV header → lead field
// Cubre nombres comunes de plantillas (es/en) + variantes de Facebook Lead Ads.
const AUTO_MATCH: Record<string, keyof ImportRow> = {
  // First name
  "first name": "first_name", "first_name": "first_name", "firstname": "first_name",
  nombre: "first_name", "primer nombre": "first_name", "nombres": "first_name",
  // Full name -> first_name (se divide después en post-procesamiento)
  // Cubre: Facebook (Name/Full Name), WhatsApp Business (saved_name),
  // contactos exportados (contact_name, display_name).
  "full name": "first_name", "full_name": "first_name", fullname: "first_name",
  "nombre completo": "first_name", "nombre y apellido": "first_name",
  name: "first_name",
  "saved_name": "first_name", "saved name": "first_name", savedname: "first_name",
  "contact_name": "first_name", "contact name": "first_name",
  "display_name": "first_name", "display name": "first_name",
  "whatsapp_name": "first_name", "whatsapp name": "first_name",
  "nombre guardado": "first_name", "nombre del contacto": "first_name",
  // Last name
  "last name": "last_name", "last_name": "last_name", lastname: "last_name",
  surname: "last_name", apellido: "last_name", apellidos: "last_name",
  // Phone
  phone: "phone", "phone_number": "phone", "phone number": "phone",
  "phone_full_number": "phone", "telephone": "phone", "mobile": "phone",
  teléfono: "phone", telefono: "phone", "número de teléfono": "phone",
  "numero de telefono": "phone", "teléfono móvil": "phone", "telefono movil": "phone",
  tel: "phone", celular: "phone", móvil: "phone", movil: "phone",
  // Email
  email: "email", "email address": "email", "e-mail": "email", "correo": "email",
  "correo electrónico": "email", "correo electronico": "email",
  // Source
  source: "source", fuente: "source", origen: "source", "lead source": "source",
  // Notes
  notes: "notes", note: "notes", notas: "notes", comentarios: "notes",
  comentario: "notes", observaciones: "notes",
  // City / State
  city: "city", ciudad: "city",
  state: "state", estado: "state", "estado/provincia": "state", provincia: "state",
}

function autoMatch(header: string): keyof ImportRow | null {
  // Limpia BOM (UTF-8 ﻿), espacios, y normaliza a lowercase.
  // El BOM aparece típicamente en CSV exportados de WhatsApp Business / Excel.
  const clean = header.replace(/^﻿/, "").toLowerCase().trim()
  return AUTO_MATCH[clean] ?? null
}

/**
 * Si tras el mapeo first_name viene como nombre completo (contiene espacios)
 * y last_name está vacío, divide automáticamente.
 * Ej. "Edith Serafin" → first_name="Edith", last_name="Serafin"
 *     "Maria de los Angeles Lopez" → first_name="Maria", last_name="de los Angeles Lopez"
 */
function splitFullName(row: ImportRow): ImportRow {
  const first = (row.first_name ?? "").trim()
  const last = (row.last_name ?? "").trim()
  if (!first || last) return row
  const tokens = first.split(/\s+/)
  if (tokens.length < 2) return row
  return {
    ...row,
    first_name: tokens[0],
    last_name: tokens.slice(1).join(" "),
  }
}

// ── Download template ─────────────────────────────────────────────────────────

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ["First Name", "Last Name", "Phone", "Email", "Source", "Notes", "City", "State"],
    ["John", "Smith", "+15551234567", "john@mail.com", "whatsapp", "", "Austin", "TX"],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Leads")
  XLSX.writeFile(wb, "leads_template.xlsx")
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateRow(row: ImportRow, idx: number): string | null {
  if (!row.first_name?.trim()) return `Row ${idx + 1}: empty first name`
  if (!row.phone?.trim() || row.phone.trim().length < 6) return `Row ${idx + 1}: invalid phone`
  if (row.email && row.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))
    return `Row ${idx + 1}: invalid email`
  return null
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const t = useTranslations("leads")
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: t("stepUpload") },
    { key: "map", label: t("stepMap") },
    { key: "preview", label: t("stepPreview") },
    { key: "done", label: t("stepDone") },
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
  const t = useTranslations("leads")
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

  const LEAD_FIELDS: { value: keyof ImportRow; label: string; required?: boolean }[] = [
    { value: "first_name", label: t("firstName"), required: true },
    { value: "last_name", label: t("lastName") },
    { value: "phone", label: t("phone"), required: true },
    { value: "email", label: t("email") },
    { value: "source", label: t("source") },
    { value: "notes", label: t("notes") },
    { value: "city", label: t("city") },
    { value: "state", label: t("state") },
  ]

  // ── File parsing ─────────────────────────────────────────────────────────

  function parseFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      alert(t("fileTooLarge"))
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer)
      const wb = XLSX.read(data, { type: "array" })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: "" })

      if (rows.length === 0) { alert(t("fileEmpty")); return }

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
    // Detecta CSV de Facebook/Meta Lead Ads por presencia de columnas Form/Channel/Stage.
    // En ese caso, columnas no mapeadas con info útil se anexan automáticamente al campo notes.
    const headerSet = new Set(headers.map((h) => h.toLowerCase().trim()))
    const isFacebookLike =
      (headerSet.has("form") || headerSet.has("channel") || headerSet.has("stage")) &&
      headerSet.has("name")

    // Columnas que se anexan a notes si tienen valor (case-insensitive lookup)
    const NOTES_EXTRA_HEADERS = ["Form", "Channel", "Stage", "Created", "Owner", "Labels"]
    // Columnas que se anexan al phone si phone está vacío (secondary)
    const PHONE_FALLBACK_HEADERS = ["Secondary phone number", "WhatsApp number"]

    const mapped = rawRows.map((row) => {
      const lead: Record<string, string | null> = {
        first_name: null, last_name: null, phone: null, email: null,
        source: null, notes: null, city: null, state: null,
      }
      mappings.forEach(({ header, field }) => {
        if (field) lead[field] = row[header] != null ? String(row[header]).trim() || null : null
      })

      if (isFacebookLike) {
        // Helper para buscar valor por header case-insensitive
        const getVal = (name: string): string | null => {
          const target = name.toLowerCase()
          for (const k of Object.keys(row)) {
            if (k.toLowerCase().trim() === target) {
              const v = row[k]
              const s = v != null ? String(v).trim() : ""
              return s || null
            }
          }
          return null
        }
        // 1) Si phone está vacío, intenta el secundario
        if (!lead.phone) {
          for (const h of PHONE_FALLBACK_HEADERS) {
            const v = getVal(h)
            if (v) { lead.phone = v; break }
          }
        }
        // 2) Enriquece notes con Form / Channel / Stage / Created / Owner / Labels
        const extras: string[] = []
        for (const h of NOTES_EXTRA_HEADERS) {
          const v = getVal(h)
          if (v) extras.push(`${h}: ${v}`)
        }
        if (extras.length > 0) {
          const extraText = extras.join(" | ")
          lead.notes = lead.notes ? `${lead.notes}\n${extraText}` : extraText
        }
      }

      return splitFullName(lead as unknown as ImportRow)
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
    if (!activeBrand) { alert(t("selectBrandFirst")); return }

    const toImport = skipErrors
      ? previewRows.filter((_, i) => !validationErrors.some((e) => e.startsWith(`Row ${i + 1}:`)))
      : previewRows

    setStep("importing")
    startTransition(async () => {
      try {
        const result = await importLeads(toImport, activeBrand.id, null)
        setImportResult(result)
        setStep("done")
      } catch (e) {
        alert(e instanceof Error ? e.message : "Error")
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
          <h1 className="text-lg font-semibold text-gray-900">{t("importTitle")}</h1>
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
            <p className="text-sm text-gray-500 font-medium">{t("dragDrop")}</p>
            <p className="text-xs text-gray-400 mt-1">{t("dragDropOr")}</p>
            <p className="text-[11px] text-gray-300 mt-3">{t("dragDropAccepted")}</p>
            <input
              id="file-input"
              type="file"
              accept=".xlsx,.csv,.xls"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f) }}
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg">
            <div>
              <p className="text-sm text-gray-700 font-medium">{t("excelTemplate")}</p>
              <p className="text-xs text-gray-400">{t("excelTemplateDesc")}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-gray-300 text-gray-700 hover:text-gray-900 cursor-pointer"
              onClick={downloadTemplate}
            >
              <Download className="w-3.5 h-3.5" />
              {t("downloadBtn")}
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP: MAP ── */}
      {step === "map" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            {t("fileLoaded", { rows: rawRows.length, cols: headers.length })}
          </p>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest px-4 py-2.5">{t("colFileHeader")}</th>
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest px-4 py-2.5">{t("colFieldHeader")}</th>
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest px-4 py-2.5">{t("colSample")}</th>
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
                          <SelectItem value="skip" className="text-gray-400 text-xs">{t("skipColumn")}</SelectItem>
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
              {t("viewPreview")}
            </Button>
            <Button variant="ghost" className="text-gray-400" onClick={() => setStep("upload")}>
              {t("backBtn")}
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP: PREVIEW ── */}
      {step === "preview" && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-700">
              {t("rowsReady", { count: previewRows.length })}
            </span>
            {validationErrors.length > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertCircle className="w-3.5 h-3.5" />
                {t("rowsWithError", { count: validationErrors.length })}
              </span>
            )}
          </div>

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
                  const rowErr = validationErrors.find((e) => e.startsWith(`Row ${i + 1}:`))
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
                {t("moreRows", { count: previewRows.length - 10 })}
              </p>
            )}
          </div>

          {validationErrors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500">{t("errorsFound")}</p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {validationErrors.slice(0, 20).map((err, i) => (
                  <p key={i} className="text-xs text-red-400 flex items-start gap-1.5">
                    <X className="w-3 h-3 mt-0.5 shrink-0" />
                    {err}
                  </p>
                ))}
                {validationErrors.length > 20 && (
                  <p className="text-xs text-gray-400">{t("moreErrors", { count: validationErrors.length - 20 })}</p>
                )}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipErrors}
                    onChange={(e) => setSkipErrors(e.target.checked)}
                    className="accent-zinc-400"
                  />
                  {t("skipErrors")}
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
                <><Loader2 className="w-4 h-4 animate-spin" />{t("importingLeads")}</>
              ) : (
                t("importBtn", { count: skipErrors ? previewRows.length - validationErrors.length : previewRows.length })
              )}
            </Button>
            <Button variant="ghost" className="text-gray-400" onClick={() => setStep("map")}>
              {t("backBtn")}
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP: IMPORTING ── */}
      {step === "importing" && (
        <div className="flex flex-col items-center gap-4 py-16">
          <Loader2 className="w-8 h-8 text-gray-500 animate-spin" />
          <p className="text-sm text-gray-500">{t("importingLeads")}</p>
        </div>
      )}

      {/* ── STEP: DONE ── */}
      {step === "done" && importResult && (
        <div className="space-y-6">
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <p className="text-xl font-semibold text-gray-900">
              {importResult.imported > 0
                ? (importResult.imported !== 1
                    ? t("importDone", { count: importResult.imported })
                    : t("importDone1", { count: importResult.imported }))
                : t("importNone")}
            </p>
            {importResult.skipped > 0 && (
              <p className="text-sm text-gray-400">
                {importResult.skipped !== 1
                  ? t("skippedPlural", { count: importResult.skipped })
                  : t("skipped", { count: importResult.skipped })}
              </p>
            )}
          </div>

          {importResult.errors.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
              <p className="text-xs font-medium text-gray-500">{t("errorRows")}</p>
              {importResult.errors.slice(0, 10).map((err, i) => (
                <p key={i} className="text-xs text-red-400">{err.row}: {err.message}</p>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={() => router.push("/leads")}
              className="cursor-pointer"
              style={{ background: "var(--brand)" }}
            >
              {t("viewImported")}
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
              {t("importAnother")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
