/**
 * Diccionario de traducciones para los reportes Excel.
 * Separado de next-intl porque corre server-side dentro de xlsx-builder
 * y report-data sin acceso a getTranslations() del request locale.
 *
 * Las claves siguen el shape exacto que necesitan los builders.
 */

export type ReportLang = "es" | "en"

export const REPORT_LANGS: ReportLang[] = ["es", "en"]

export function isReportLang(v: string | null | undefined): v is ReportLang {
  return v === "es" || v === "en"
}

export type ReportDict = {
  // Sheet names
  sheetKpis: string
  sheetResumen: string
  sheetTransacciones: string

  // Hoja 1: Resumen por paciente — headers
  hResumenBrand: string
  hResumenLead: string
  hResumenEmail: string
  hResumenPhone: string
  hResumenRep: string
  hResumenNumSales: string
  hResumenTotalContratado: string
  hResumenTotalCobrado: string
  hResumenSaldoPendiente: string
  hResumenProximaFecha: string
  hResumenProximaAmount: string
  hResumenStatus: string
  resumenEmptyMsg: string

  // Hoja 2: Transacciones — headers
  hTransFecha: string
  hTransBrand: string
  hTransLead: string
  hTransRep: string
  hTransTipo: string
  hTransProducto: string
  hTransMonto: string
  hTransMetodo: string
  hTransNotas: string
  transEmptyMsg: string

  // Tipo de transacción
  tipoVenta: string
  tipoAbonoPlan: string

  // Hoja 3: KPIs
  kpisTitle: string
  kpisPeriodo: string
  kpisMarca: string
  kpisTotalCobrado: string
  kpisTotalPorCobrar: string
  kpisVentasNuevas: string
  kpisPlanesActivos: string
  kpisPromedioTicket: string
  kpisPorMarca: string
  kpisColMarca: string
  kpisColCobrado: string
  kpisColPendiente: string
  kpisPorRep: string
  kpisColRep: string
  kpisColVentas: string
  kpisSinReps: string

  // Status texts en Resumen
  statusSinPlan: string
  statusAlDia: string
  statusPlanCompleto: string
  /** Función porque incluye número y plural */
  statusAtrasado: (days: number) => string

  // Period / brand labels
  periodoHistorico: string
  marcaTodas: string

  // Filename slug for "historico"
  filenameHistorico: string
}

const ES: ReportDict = {
  sheetKpis: "KPIs",
  sheetResumen: "Resumen por paciente",
  sheetTransacciones: "Transacciones",

  hResumenBrand: "Marca",
  hResumenLead: "Lead",
  hResumenEmail: "Email",
  hResumenPhone: "Teléfono",
  hResumenRep: "Rep",
  hResumenNumSales: "# Ventas",
  hResumenTotalContratado: "Total contratado",
  hResumenTotalCobrado: "Total cobrado",
  hResumenSaldoPendiente: "Saldo pendiente",
  hResumenProximaFecha: "Próxima cuota (fecha)",
  hResumenProximaAmount: "Próxima cuota ($)",
  hResumenStatus: "Status",
  resumenEmptyMsg: "Sin datos en el periodo seleccionado",

  hTransFecha: "Fecha cobro",
  hTransBrand: "Marca",
  hTransLead: "Lead",
  hTransRep: "Rep",
  hTransTipo: "Tipo",
  hTransProducto: "Producto",
  hTransMonto: "Monto",
  hTransMetodo: "Método pago",
  hTransNotas: "Notas",
  transEmptyMsg: "Sin transacciones en el periodo seleccionado",

  tipoVenta: "Venta",
  tipoAbonoPlan: "Abono plan",

  kpisTitle: "Reporte de ventas",
  kpisPeriodo: "Periodo",
  kpisMarca: "Marca",
  kpisTotalCobrado: "Total cobrado en periodo",
  kpisTotalPorCobrar: "Total por cobrar (cartera)",
  kpisVentasNuevas: "Ventas nuevas en periodo",
  kpisPlanesActivos: "Planes activos",
  kpisPromedioTicket: "Promedio ticket",
  kpisPorMarca: "POR MARCA",
  kpisColMarca: "Marca",
  kpisColCobrado: "Cobrado",
  kpisColPendiente: "Pendiente",
  kpisPorRep: "POR REP (top 10 por monto cobrado)",
  kpisColRep: "Rep",
  kpisColVentas: "# Ventas",
  kpisSinReps: "Sin reps con ventas en el periodo",

  statusSinPlan: "Sin plan",
  statusAlDia: "Al día",
  statusPlanCompleto: "Plan completo",
  statusAtrasado: (days) => `Atrasado ${days} día${days !== 1 ? "s" : ""}`,

  periodoHistorico: "Histórico completo",
  marcaTodas: "Todas",

  filenameHistorico: "historico",
}

const EN: ReportDict = {
  sheetKpis: "KPIs",
  sheetResumen: "Patient summary",
  sheetTransacciones: "Transactions",

  hResumenBrand: "Brand",
  hResumenLead: "Lead",
  hResumenEmail: "Email",
  hResumenPhone: "Phone",
  hResumenRep: "Rep",
  hResumenNumSales: "# Sales",
  hResumenTotalContratado: "Total agreed",
  hResumenTotalCobrado: "Total collected",
  hResumenSaldoPendiente: "Outstanding balance",
  hResumenProximaFecha: "Next installment (date)",
  hResumenProximaAmount: "Next installment ($)",
  hResumenStatus: "Status",
  resumenEmptyMsg: "No data for the selected period",

  hTransFecha: "Payment date",
  hTransBrand: "Brand",
  hTransLead: "Lead",
  hTransRep: "Rep",
  hTransTipo: "Type",
  hTransProducto: "Product",
  hTransMonto: "Amount",
  hTransMetodo: "Payment method",
  hTransNotas: "Notes",
  transEmptyMsg: "No transactions in the selected period",

  tipoVenta: "Sale",
  tipoAbonoPlan: "Plan payment",

  kpisTitle: "Sales report",
  kpisPeriodo: "Period",
  kpisMarca: "Brand",
  kpisTotalCobrado: "Total collected in period",
  kpisTotalPorCobrar: "Total outstanding (portfolio)",
  kpisVentasNuevas: "New sales in period",
  kpisPlanesActivos: "Active plans",
  kpisPromedioTicket: "Average ticket",
  kpisPorMarca: "BY BRAND",
  kpisColMarca: "Brand",
  kpisColCobrado: "Collected",
  kpisColPendiente: "Outstanding",
  kpisPorRep: "BY REP (top 10 by collected amount)",
  kpisColRep: "Rep",
  kpisColVentas: "# Sales",
  kpisSinReps: "No reps with sales in the period",

  statusSinPlan: "No plan",
  statusAlDia: "On track",
  statusPlanCompleto: "Plan completed",
  statusAtrasado: (days) => `Overdue ${days} day${days !== 1 ? "s" : ""}`,

  periodoHistorico: "All history",
  marcaTodas: "All",

  filenameHistorico: "all_history",
}

export function getReportDict(lang: ReportLang): ReportDict {
  return lang === "en" ? EN : ES
}
