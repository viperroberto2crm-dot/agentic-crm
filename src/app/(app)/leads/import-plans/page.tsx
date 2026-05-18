"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import * as XLSX from "xlsx"
import { ArrowLeft, Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useBrand } from "@/context/brand-context"
import {
  importPaymentPlans,
  type PlanImportRow,
  type AbonoImportRow,
  type ImportPlansResult,
} from "./actions"

type RawRow = Record<string, unknown>

function toNumber(v: unknown): number {
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ""))
    return isNaN(n) ? 0 : n
  }
  return 0
}

function toNullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}

function toNullableNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""))
  return Number.isFinite(n) ? n : null
}

// Excel a veces convierte fechas a números serial. Esto los normaliza.
function excelDateToISO(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    const yyyy = String(d.y).padStart(4, "0")
    const mm = String(d.m).padStart(2, "0")
    const dd = String(d.d).padStart(2, "0")
    return `${yyyy}-${mm}-${dd}`
  }
  return String(v).trim() || null
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new()

  const plans = XLSX.utils.aoa_to_sheet([
    [
      "ref_id",
      "first_name",
      "last_name",
      "phone",
      "email",
      "plan_name",
      "plan_per_installment",
      "plan_installments",
      "plan_total",
      "plan_frequency",
      "plan_first_due",
      "plan_notes",
    ],
    [
      "P001",
      "Adilene",
      "Flores",
      "21356256000",
      "",
      "Weekly $75",
      75,
      4,
      "",
      "weekly",
      "04/22/2026",
      "S.W.",
    ],
    [
      "P002",
      "Karina",
      "Abreo",
      "",
      "",
      "Monthly $299",
      299,
      1,
      "",
      "monthly",
      "04/10/2026",
      "S.W. — solo 1 pago",
    ],
    [
      "P003",
      "Irma",
      "Anaya",
      "",
      "",
      "Monthly/Weekly $499",
      "",
      "",
      499,
      "monthly",
      "04/13/2026",
      "SSP-Andreina",
    ],
  ])

  const abonos = XLSX.utils.aoa_to_sheet([
    ["ref_id", "amount", "date", "method", "notes"],
    ["P001", 75, "04/22/2026", "cash", "Primer pago"],
    ["P001", 75, "04/29/2026", "cash", ""],
    ["P001", 75, "05/06/2026", "card", ""],
    ["P002", 75, "05/01/2026", "transfer", ""],
  ])

  const readme = XLSX.utils.aoa_to_sheet([
    ["INSTRUCCIONES"],
    [""],
    ["Hoja 'Plans': una fila por paciente con su plan de pago."],
    ["Hoja 'Payments': UNA FILA POR CADA ABONO YA COBRADO. Déjala vacía si todos los pagos son a futuro."],
    [""],
    ["ref_id: cualquier código único que tú decidas (P001, P002, paciente-1, etc)."],
    ["  Si llenas la hoja Payments, usa el mismo ref_id para vincular abonos al plan correcto."],
    [""],
    ["MONTO DEL PLAN — dos formas (escoge una):"],
    ["  A) Llena plan_per_installment + plan_installments. Ej: $75 × 4 = $300 (el sistema computa)."],
    ["  B) Llena plan_total directo. Útil cuando no se divide en cuotas iguales."],
    ["  Si llenas las dos, plan_total gana."],
    [""],
    ["plan_frequency: 'weekly' (semanal), 'biweekly' (quincenal), 'monthly' (mensual) o número de días (ej. 21)."],
    ["plan_first_due: fecha del primer cobro. Formato MM/DD/YYYY (ej. 04/22/2026)."],
    ["plan_installments: número de cuotas totales. Si se deja vacío no se genera schedule."],
    ["plan_notes: notas libres (ej. nombre del rep, observaciones)."],
    [""],
    ["HOJA PAYMENTS (opcional, solo si tienes abonos cobrados ya):"],
    ["  method: cash, card, transfer, check, other."],
    ["  date: formato MM/DD/YYYY."],
  ])

  XLSX.utils.book_append_sheet(wb, plans, "Plans")
  XLSX.utils.book_append_sheet(wb, abonos, "Payments")
  XLSX.utils.book_append_sheet(wb, readme, "README")
  XLSX.writeFile(wb, "plans_template.xlsx")
}

export default function ImportPlansPage() {
  const router = useRouter()
  const { activeBrand } = useBrand()
  const [isPending, startTransition] = useTransition()
  const [plans, setPlans] = useState<PlanImportRow[]>([])
  const [abonos, setAbonos] = useState<AbonoImportRow[]>([])
  const [fileName, setFileName] = useState<string>("")
  const [parseError, setParseError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportPlansResult | null>(null)
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload")

  function handleFile(file: File) {
    setParseError(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result
        if (!data) throw new Error("Archivo vacío")
        const wb = XLSX.read(data, { type: "binary" })
        const plansSheet = wb.Sheets["Plans"]
        const paymentsSheet = wb.Sheets["Payments"]
        if (!plansSheet) throw new Error("Falta hoja 'Plans' en el Excel")

        const plansRaw = XLSX.utils.sheet_to_json<RawRow>(plansSheet, { defval: "" })
        const paymentsRaw = paymentsSheet
          ? XLSX.utils.sheet_to_json<RawRow>(paymentsSheet, { defval: "" })
          : []

        const parsedPlans: PlanImportRow[] = plansRaw.map((r) => ({
          ref_id: String(r.ref_id ?? "").trim(),
          first_name: String(r.first_name ?? "").trim(),
          last_name: toNullableString(r.last_name),
          phone: toNullableString(r.phone),
          email: toNullableString(r.email),
          plan_name: String(r.plan_name ?? "").trim(),
          plan_total: toNullableNumber(r.plan_total),
          plan_per_installment: toNullableNumber(r.plan_per_installment),
          plan_notes: toNullableString(r.plan_notes),
          plan_installments: toNullableNumber(r.plan_installments),
          plan_frequency: toNullableString(r.plan_frequency),
          plan_first_due: excelDateToISO(r.plan_first_due),
        }))

        const parsedAbonos: AbonoImportRow[] = paymentsRaw.map((r) => ({
          ref_id: String(r.ref_id ?? "").trim(),
          amount: toNumber(r.amount),
          date: excelDateToISO(r.date) ?? "",
          method: toNullableString(r.method),
          notes: toNullableString(r.notes),
        }))

        setPlans(parsedPlans.filter((p) => p.ref_id || p.first_name))
        setAbonos(parsedAbonos.filter((a) => a.ref_id))
        setStep("preview")
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "Error parseando archivo")
      }
    }
    reader.readAsBinaryString(file)
  }

  function handleImport() {
    if (!activeBrand) {
      setParseError("Selecciona una marca activa primero")
      return
    }
    startTransition(async () => {
      try {
        const res = await importPaymentPlans(plans, abonos, activeBrand.id)
        setResult(res)
        setStep("done")
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "Error importando")
      }
    })
  }

  // Resumen para preview
  const abonosByRef = new Map<string, number>()
  for (const a of abonos) abonosByRef.set(a.ref_id, (abonosByRef.get(a.ref_id) ?? 0) + 1)
  const orphanAbonos = abonos.filter((a) => !plans.find((p) => p.ref_id === a.ref_id)).length

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/leads" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-lg font-semibold text-foreground">Importar Payment Plans</h1>
      </div>

      {activeBrand && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: activeBrand.brand_color ?? "#3B82F6" }}
          />
          {activeBrand.name}
        </div>
      )}

      {/* STEP UPLOAD */}
      {step === "upload" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-white p-4 space-y-3">
            <div className="flex items-start gap-3">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Template Excel (2 hojas)</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Una fila por paciente en hoja <b>Plans</b>. Una fila por abono en hoja{" "}
                  <b>Payments</b>. Las une el campo <code>ref_id</code>.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={downloadTemplate} className="gap-1.5">
                <Download className="w-3.5 h-3.5" />
                Descargar template
              </Button>
            </div>
          </div>

          <label
            htmlFor="file-plans-input"
            className="block border-2 border-dashed rounded-xl p-12 text-center cursor-pointer border-gray-200 hover:border-gray-300 hover:bg-white transition-colors"
          >
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            <p className="text-sm text-gray-500 font-medium">Sube tu Excel relleno</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx — debe tener hojas Plans + Payments</p>
            <input
              id="file-plans-input"
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />
          </label>

          {parseError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
              {parseError}
            </div>
          )}
        </div>
      )}

      {/* STEP PREVIEW */}
      {step === "preview" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-white p-4">
            <p className="text-sm font-medium text-foreground mb-3">{fileName}</p>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <Stat label="Planes detectados" value={plans.length} />
              <Stat label="Abonos detectados" value={abonos.length} />
              <Stat
                label="Abonos huérfanos"
                value={orphanAbonos}
                warning={orphanAbonos > 0}
              />
            </div>
          </div>

          {plans.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">ref_id</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Paciente</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Plan</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Total</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Abonos</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.slice(0, 20).map((p, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.ref_id}</td>
                      <td className="px-3 py-2 text-foreground">
                        {p.first_name} {p.last_name ?? ""}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{p.plan_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        ${(
                          p.plan_total ??
                          (p.plan_per_installment != null && p.plan_installments != null
                            ? p.plan_per_installment * p.plan_installments
                            : 0)
                        ).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {abonosByRef.get(p.ref_id) ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plans.length > 20 && (
                <p className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
                  +{plans.length - 20} planes más (no mostrados en preview)
                </p>
              )}
            </div>
          )}

          {parseError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
              {parseError}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleImport}
              disabled={isPending || plans.length === 0 || !activeBrand}
              style={{ background: "var(--brand)" }}
            >
              {isPending ? "Importando…" : `Importar ${plans.length} planes + ${abonos.length} abonos`}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setStep("upload")
                setPlans([])
                setAbonos([])
                setFileName("")
              }}
              disabled={isPending}
            >
              ← Volver
            </Button>
          </div>
        </div>
      )}

      {/* STEP DONE */}
      {step === "done" && result && (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-emerald-900">Import completado</p>
                <p className="text-xs text-emerald-700 mt-1">
                  {result.plans_imported} planes creados · {result.abonos_imported} abonos registrados
                </p>
              </div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
              <p className="text-xs font-semibold text-red-900">
                {result.errors.length} errores:
              </p>
              <ul className="space-y-1 text-xs text-red-700 max-h-60 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-red-400 shrink-0">[{e.sheet}]</span>
                    {e.ref_id && <span className="font-mono text-red-400">{e.ref_id}</span>}
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={() => router.push("/leads")}>Ver leads</Button>
            <Button
              variant="ghost"
              onClick={() => {
                setStep("upload")
                setResult(null)
                setPlans([])
                setAbonos([])
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

function Stat({
  label,
  value,
  warning,
}: {
  label: string
  value: number
  warning?: boolean
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={`text-2xl font-semibold tabular-nums ${
          warning ? "text-amber-600" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  )
}
