/**
 * Construye el workbook .xlsx con 3 hojas a partir de ReportData.
 * No hace queries — solo serializa datos.
 *
 * Hojas:
 *   1. "Resumen por paciente" — una fila por lead con totales
 *   2. "Transacciones"        — una fila por cobro real (sale standalone o abono)
 *   3. "KPIs"                  — layout vertical con métricas agregadas
 */

import * as XLSX from "xlsx"
import type { ReportData, ResumenRow, TransaccionRow, Kpis } from "./report-data"

function centsToUsd(cents: number | null | undefined): number {
  if (cents === null || cents === undefined) return 0
  return Math.round(cents) / 100
}

function fmtUsd(cents: number | null | undefined): string {
  return `$${centsToUsd(cents).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Hoja 1: Resumen por paciente.
 * Headers en español; columnas en mismo orden que ResumenRow.
 */
function buildResumenSheet(resumen: ResumenRow[]): XLSX.WorkSheet {
  const headers = [
    "Marca",
    "Lead",
    "Email",
    "Teléfono",
    "Rep",
    "# Ventas",
    "Total contratado",
    "Total cobrado",
    "Saldo pendiente",
    "Próxima cuota (fecha)",
    "Próxima cuota ($)",
    "Status",
  ]

  if (resumen.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ["Sin datos en el periodo seleccionado"]])
    applyColumnWidths(ws, [16, 28, 28, 16, 18, 9, 16, 16, 16, 18, 16, 22])
    return ws
  }

  const rows = resumen.map((r) => [
    r.brand_name,
    r.lead_name,
    r.email ?? "",
    r.phone ?? "",
    r.rep_name ?? "",
    r.num_sales,
    centsToUsd(r.total_contratado_cents),
    centsToUsd(r.total_cobrado_cents),
    centsToUsd(r.saldo_pendiente_cents),
    r.proxima_cuota_fecha ?? "",
    r.proxima_cuota_cents !== null ? centsToUsd(r.proxima_cuota_cents) : "",
    r.status_text,
  ])

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  applyColumnWidths(ws, [16, 28, 28, 16, 18, 9, 16, 16, 16, 18, 16, 22])

  // Formato moneda en columnas G, H, I, K (indices 6, 7, 8, 10)
  const moneyCols = [6, 7, 8, 10]
  applyMoneyFormat(ws, moneyCols, rows.length)
  return ws
}

/**
 * Hoja 2: Transacciones.
 */
function buildTransaccionesSheet(transacciones: TransaccionRow[]): XLSX.WorkSheet {
  const headers = [
    "Fecha cobro",
    "Marca",
    "Lead",
    "Rep",
    "Tipo",
    "Producto",
    "Monto",
    "Método pago",
    "Notas",
  ]

  if (transacciones.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ["Sin transacciones en el periodo seleccionado"]])
    applyColumnWidths(ws, [18, 16, 28, 18, 12, 24, 14, 14, 40])
    return ws
  }

  const rows = transacciones.map((t) => [
    t.fecha_cobro.slice(0, 10),
    t.brand_name,
    t.lead_name,
    t.rep_name ?? "",
    t.tipo,
    t.producto ?? "",
    centsToUsd(t.monto_cents),
    t.metodo_pago ?? "",
    t.notas ?? "",
  ])

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  applyColumnWidths(ws, [18, 16, 28, 18, 12, 24, 14, 14, 40])
  applyMoneyFormat(ws, [6], rows.length)
  return ws
}

/**
 * Hoja 3: KPIs. Layout vertical.
 */
function buildKpisSheet(kpis: Kpis): XLSX.WorkSheet {
  const rows: (string | number | null)[][] = [
    ["Reporte de ventas — Si Se Pierde / SunnySlim", null],
    [],
    ["Periodo", kpis.periodo_label],
    ["Marca", kpis.marca_label],
    [],
    ["Total cobrado en periodo", fmtUsd(kpis.total_cobrado_cents)],
    ["Total por cobrar (cartera)", fmtUsd(kpis.total_por_cobrar_cents)],
    ["Ventas nuevas en periodo", kpis.ventas_nuevas_count],
    ["Planes activos", kpis.planes_activos_count],
    ["Promedio ticket", fmtUsd(kpis.promedio_ticket_cents)],
    [],
    ["POR MARCA", null],
    ["Marca", "Cobrado", "Pendiente"],
  ]

  for (const m of kpis.por_marca) {
    rows.push([m.brand_name, fmtUsd(m.cobrado_cents), fmtUsd(m.pendiente_cents)])
  }

  rows.push([])
  rows.push(["POR REP (top 10 por monto cobrado)", null])
  rows.push(["Rep", "Cobrado", "# Ventas"])

  for (const r of kpis.por_rep) {
    rows.push([r.rep_name, fmtUsd(r.cobrado_cents), r.ventas_count])
  }

  if (kpis.por_rep.length === 0) {
    rows.push(["Sin reps con ventas en el periodo", "", ""])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  applyColumnWidths(ws, [32, 18, 14])
  return ws
}

function applyColumnWidths(ws: XLSX.WorkSheet, widths: number[]): void {
  ws["!cols"] = widths.map((w) => ({ wch: w }))
}

/**
 * Aplica formato número de moneda USD a celdas específicas.
 * SheetJS edición comunitaria soporta `z` para format codes pero no styling.
 */
function applyMoneyFormat(ws: XLSX.WorkSheet, colIndices: number[], rowCount: number): void {
  for (let r = 1; r <= rowCount; r++) {
    for (const c of colIndices) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr]
      if (cell && typeof cell.v === "number") {
        cell.t = "n"
        cell.z = '"$"#,##0.00'
      }
    }
  }
}

/**
 * API pública: arma el workbook y devuelve el buffer xlsx.
 */
export function buildReportWorkbook(data: ReportData): Buffer {
  const wb = XLSX.utils.book_new()

  const resumenWs = buildResumenSheet(data.resumen)
  const transWs = buildTransaccionesSheet(data.transacciones)
  const kpisWs = buildKpisSheet(data.kpis)

  XLSX.utils.book_append_sheet(wb, kpisWs, "KPIs")
  XLSX.utils.book_append_sheet(wb, resumenWs, "Resumen por paciente")
  XLSX.utils.book_append_sheet(wb, transWs, "Transacciones")

  const buffer = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  }) as Buffer

  return buffer
}

/**
 * Genera nombre de archivo según los filtros aplicados.
 */
export function buildReportFilename(data: ReportData): string {
  const filters = data.meta.filters_applied
  const brand = filters.brandId ? data.kpis.marca_label.toLowerCase().replace(/[^a-z0-9]/g, "") : "todas"
  if (filters.historico || (!filters.from && !filters.to)) {
    return `reporte_${brand}_historico.xlsx`
  }
  const from = filters.from!.slice(0, 10)
  const to = filters.to!.slice(0, 10)
  return `reporte_${brand}_${from}_${to}.xlsx`
}
