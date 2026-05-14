/**
 * Tiny CSV builder. RFC-4180-ish: quotes fields with comma, quote or newline,
 * escapes embedded quotes by doubling them. No external deps.
 */

export type CsvCell = string | number | boolean | null | undefined

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return ""
  const s = String(value)
  if (s.includes(",") || s.includes("\"") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

const UTF8_BOM = "﻿"

export function buildCsv(headers: string[], rows: CsvCell[][]): string {
  const lines: string[] = []
  lines.push(headers.map(escapeCell).join(","))
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","))
  }
  // Prepend BOM so Excel opens UTF-8 properly.
  return UTF8_BOM + lines.join("\r\n")
}

/**
 * Build a filename "<entity>_<from>_<to>.csv" using yyyy-mm-dd.
 * Falls back to "<entity>.csv" if range is missing.
 */
export function buildCsvFilename(
  entity: string,
  range: { from: string; to: string } | null
): string {
  if (!range) return `${entity}.csv`
  const fromDate = new Date(range.from)
  const toDate = new Date(range.to)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`
  return `${entity}_${fmt(fromDate)}_${fmt(toDate)}.csv`
}
