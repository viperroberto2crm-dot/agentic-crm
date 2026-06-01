/**
 * Construye el workbook .xlsx con 3 hojas a partir de ReportData.
 * No hace queries — solo serializa datos.
 *
 * Hojas:
 *   1. Resumen por paciente (una fila por lead con totales)
 *   2. Transacciones (una fila por cobro real: sale standalone o abono)
 *   3. KPIs (layout vertical con métricas agregadas)
 *
 * Idioma: el caller pasa `lang` ("es"|"en"). Todo el texto (sheet names,
 * headers, status, filename) se traduce desde `translations.ts`. El locale
 * del usuario en next-intl debe propagarse hasta aquí desde el endpoint.
 */

import * as XLSX from "xlsx"
import type { ReportData, ResumenRow, TransaccionRow, Kpis } from "./report-data"
import { getReportDict, type ReportLang, type ReportDict } from "./translations"

function centsToUsd(cents: number | null | undefined): number {
  if (cents === null || cents === undefined) return 0
  return Math.round(cents) / 100
}

function fmtUsd(cents: number | null | undefined): string {
  return `$${centsToUsd(cents).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Hoja 1: Resumen por paciente.
 */
function buildResumenSheet(resumen: ResumenRow[], d: ReportDict): XLSX.WorkSheet {
  const headers = [
    d.hResumenBrand,
    d.hResumenLead,
    d.hResumenEmail,
    d.hResumenPhone,
    d.hResumenRep,
    d.hResumenNumSales,
    d.hResumenTotalContratado,
    d.hResumenTotalCobrado,
    d.hResumenSaldoPendiente,
    d.hResumenProximaFecha,
    d.hResumenProximaAmount,
    d.hResumenStatus,
  ]

  if (resumen.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([headers, [d.resumenEmptyMsg]])
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
function buildTransaccionesSheet(transacciones: TransaccionRow[], d: ReportDict): XLSX.WorkSheet {
  const headers = [
    d.hTransFecha,
    d.hTransBrand,
    d.hTransLead,
    d.hTransRep,
    d.hTransTipo,
    d.hTransProducto,
    d.hTransMonto,
    d.hTransMetodo,
    d.hTransNotas,
  ]

  if (transacciones.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([headers, [d.transEmptyMsg]])
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
function buildKpisSheet(kpis: Kpis, d: ReportDict): XLSX.WorkSheet {
  const rows: (string | number | null)[][] = [
    [d.kpisTitle, null],
    [],
    [d.kpisPeriodo, kpis.periodo_label],
    [d.kpisMarca, kpis.marca_label],
    [],
    [d.kpisTotalCobrado, fmtUsd(kpis.total_cobrado_cents)],
    [d.kpisTotalPorCobrar, fmtUsd(kpis.total_por_cobrar_cents)],
    [d.kpisVentasNuevas, kpis.ventas_nuevas_count],
    [d.kpisPlanesActivos, kpis.planes_activos_count],
    [d.kpisPromedioTicket, fmtUsd(kpis.promedio_ticket_cents)],
    [],
    [d.kpisPorMarca, null],
    [d.kpisColMarca, d.kpisColCobrado, d.kpisColPendiente],
  ]

  for (const m of kpis.por_marca) {
    rows.push([m.brand_name, fmtUsd(m.cobrado_cents), fmtUsd(m.pendiente_cents)])
  }

  rows.push([])
  rows.push([d.kpisPorRep, null])
  rows.push([d.kpisColRep, d.kpisColCobrado, d.kpisColVentas])

  for (const r of kpis.por_rep) {
    rows.push([r.rep_name, fmtUsd(r.cobrado_cents), r.ventas_count])
  }

  if (kpis.por_rep.length === 0) {
    rows.push([d.kpisSinReps, "", ""])
  }

  // POR MÉTODO DE PAGO (cash, card, stripe, etc.)
  rows.push([])
  rows.push([d.kpisPorMetodoPago, null])
  rows.push([d.kpisColMetodo, d.kpisColCobrado, d.kpisColCount])

  for (const m of kpis.por_metodo_pago) {
    // Capitalizar método (cash -> Cash, card -> Card, etc.)
    const label = m.metodo.charAt(0).toUpperCase() + m.metodo.slice(1)
    rows.push([label, fmtUsd(m.cobrado_cents), m.count])
  }

  if (kpis.por_metodo_pago.length === 0) {
    rows.push([d.kpisSinMetodos, "", ""])
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
export function buildReportWorkbook(data: ReportData, lang: ReportLang = "es"): Buffer {
  const d = getReportDict(lang)
  const wb = XLSX.utils.book_new()

  const resumenWs = buildResumenSheet(data.resumen, d)
  const transWs = buildTransaccionesSheet(data.transacciones, d)
  const kpisWs = buildKpisSheet(data.kpis, d)

  XLSX.utils.book_append_sheet(wb, kpisWs, d.sheetKpis)
  XLSX.utils.book_append_sheet(wb, resumenWs, d.sheetResumen)
  XLSX.utils.book_append_sheet(wb, transWs, d.sheetTransacciones)

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
export function buildReportFilename(data: ReportData, lang: ReportLang = "es"): string {
  const d = getReportDict(lang)
  const filters = data.meta.filters_applied
  const brand = filters.brandId ? data.kpis.marca_label.toLowerCase().replace(/[^a-z0-9]/g, "") : (lang === "en" ? "all" : "todas")
  const prefix = lang === "en" ? "report" : "reporte"
  if (filters.historico || (!filters.from && !filters.to)) {
    return `${prefix}_${brand}_${d.filenameHistorico}.xlsx`
  }
  const from = filters.from!.slice(0, 10)
  const to = filters.to!.slice(0, 10)
  return `${prefix}_${brand}_${from}_${to}.xlsx`
}
