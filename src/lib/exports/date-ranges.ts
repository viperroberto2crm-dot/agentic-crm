/**
 * Date-range helpers for export filters.
 * Pure client-side. All functions return { from, to } as ISO strings
 * spanning [from 00:00:00.000 local] to [to 23:59:59.999 local].
 */

export type DateRange = { from: string; to: string }

export type PresetKey =
  | "today"
  | "thisWeek"
  | "thisMonth"
  | "lastMonth"
  | "thisQuarter"
  | "thisYear"
  | "custom"

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

function rangeFromDates(from: Date, to: Date): DateRange {
  return { from: startOfDay(from).toISOString(), to: endOfDay(to).toISOString() }
}

export function getPresetRange(preset: PresetKey, now: Date = new Date()): DateRange {
  switch (preset) {
    case "today": {
      return rangeFromDates(now, now)
    }
    case "thisWeek": {
      // ISO week: Monday → Sunday
      const day = now.getDay() // 0 Sun ... 6 Sat
      const diffToMonday = (day + 6) % 7
      const monday = new Date(now)
      monday.setDate(now.getDate() - diffToMonday)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return rangeFromDates(monday, sunday)
    }
    case "thisMonth": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1)
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return rangeFromDates(first, last)
    }
    case "lastMonth": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return rangeFromDates(first, last)
    }
    case "thisQuarter": {
      const quarter = Math.floor(now.getMonth() / 3)
      const first = new Date(now.getFullYear(), quarter * 3, 1)
      const last = new Date(now.getFullYear(), quarter * 3 + 3, 0)
      return rangeFromDates(first, last)
    }
    case "thisYear": {
      const first = new Date(now.getFullYear(), 0, 1)
      const last = new Date(now.getFullYear(), 11, 31)
      return rangeFromDates(first, last)
    }
    case "custom": {
      // Caller is responsible for providing dates; default to thisMonth.
      return getPresetRange("thisMonth", now)
    }
  }
}

/**
 * Convert an ISO string (or yyyy-mm-dd) into a local Date.
 * Used to format the "yyyy-mm-dd" portion for filenames.
 */
export function toDateInputValue(iso: string): string {
  const d = new Date(iso)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Build [00:00:00.000, 23:59:59.999] ISO range from yyyy-mm-dd inputs.
 */
export function rangeFromInputs(fromInput: string, toInput: string): DateRange | null {
  if (!fromInput || !toInput) return null
  const from = new Date(`${fromInput}T00:00:00`)
  const to = new Date(`${toInput}T23:59:59.999`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  if (from > to) return null
  return { from: from.toISOString(), to: to.toISOString() }
}
