/**
 * Date range helpers for the Dashboard filters.
 *
 * Convention:
 * - "Date-only" strings use `YYYY-MM-DD` and are interpreted in the user's
 *   timezone.
 * - UTC bounds are returned as ISO strings (`{ start, end }`), where `start`
 *   is the user-local midnight at the beginning of `from` and `end` is the
 *   user-local midnight at the beginning of `to + 1 day` (exclusive upper).
 *
 * The same convention is already used by `getDayRange` in
 * `@/lib/queries/dashboard`, so KPI queries that filter by
 * `gte(col, start).lt(col, end)` keep working without changes.
 */

export type DateRangePreset =
  | "today"
  | "next7"
  | "next30"
  | "last7"
  | "last30"
  | "thisWeek"
  | "thisMonth"
  | "lastMonth"
  | "thisQuarter"
  | "thisYear"
  | "custom"

export type DateRange = { start: string; end: string }

/** UI-friendly active range (date-only strings + which preset is selected). */
export type ActiveDateRange = {
  /** ISO date-only string (YYYY-MM-DD) — inclusive start. */
  from: string
  /** ISO date-only string (YYYY-MM-DD) — inclusive end. */
  to: string
  preset: DateRangePreset
}

const DEFAULT_TIMEZONE = "America/Mexico_City"

// ─── Low-level timezone primitives ─────────────────────────────────────────

/**
 * Return year/month/day (in the given timezone) for a given Date.
 * Month is 1-indexed (1 = January).
 */
function ymdInTimezone(
  date: Date,
  timezone: string
): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = fmt.formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "0"
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
  }
}

/**
 * Given a calendar date (year/month/day, month 1-indexed) and a timezone,
 * return the UTC `Date` that represents midnight at the start of that
 * calendar date in that timezone.
 *
 * Algoritmo: tomamos el UTC actual, lo renderizamos en TZ, y tratamos las
 * partes (year/month/day/hour/minute/second) como si fueran UTC wall-clock
 * para calcular el drift respecto al objetivo (también wall-clock UTC).
 * Esto encuentra el UTC instant exacto cuya hora local en TZ es 00:00:00.
 *
 * La versión anterior solo comparaba el calendario (día), no la hora, lo que
 * devolvía cualquier UTC dentro del día TZ — típicamente 5pm en vez de
 * midnight. Confirmado con tests para LA en PDT y PST.
 */
function utcMidnightFor(
  year: number,
  month: number,
  day: number,
  timezone: string
): Date {
  let utc = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(utc))
    const get = (t: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === t)?.value ?? "0"
    let seenHour = parseInt(get("hour"), 10)
    if (seenHour === 24) seenHour = 0 // algunos locales rinden midnight como "24"
    const seenWall = Date.UTC(
      parseInt(get("year"), 10),
      parseInt(get("month"), 10) - 1,
      parseInt(get("day"), 10),
      seenHour,
      parseInt(get("minute"), 10),
      parseInt(get("second"), 10),
      0,
    )
    const targetWall = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
    const drift = seenWall - targetWall
    if (drift === 0) break
    utc -= drift
  }
  return new Date(utc)
}

// ─── Date-only string helpers ──────────────────────────────────────────────

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidYmd(value: string): boolean {
  const m = YMD_RE.exec(value)
  if (!m) return false
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const d = parseInt(m[3], 10)
  if (mo < 1 || mo > 12) return false
  if (d < 1 || d > 31) return false
  // Reject impossible dates (e.g. 2024-02-31).
  const probe = new Date(Date.UTC(y, mo - 1, d))
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === mo - 1 &&
    probe.getUTCDate() === d
  )
}

export function ymdToParts(value: string): {
  year: number
  month: number
  day: number
} | null {
  const m = YMD_RE.exec(value)
  if (!m) return null
  return {
    year: parseInt(m[1], 10),
    month: parseInt(m[2], 10),
    day: parseInt(m[3], 10),
  }
}

export function formatYmd(year: number, month: number, day: number): string {
  const m = month.toString().padStart(2, "0")
  const d = day.toString().padStart(2, "0")
  return `${year}-${m}-${d}`
}

export function ymdFromDateInTz(date: Date, timezone: string): string {
  const { year, month, day } = ymdInTimezone(date, timezone)
  return formatYmd(year, month, day)
}

// ─── Range conversion ──────────────────────────────────────────────────────

/**
 * Convert date-only `from` / `to` (inclusive) to UTC bounds in the user's
 * timezone. `end` is exclusive (= midnight at start of day after `to`).
 */
export function dateOnlyRangeToUtc(
  fromYmd: string,
  toYmd: string,
  timezone: string
): DateRange {
  const tz = timezone || DEFAULT_TIMEZONE
  const fromParts = ymdToParts(fromYmd)
  const toParts = ymdToParts(toYmd)
  if (!fromParts || !toParts) {
    throw new Error("dateOnlyRangeToUtc: invalid YYYY-MM-DD input")
  }

  const startUtc = utcMidnightFor(
    fromParts.year,
    fromParts.month,
    fromParts.day,
    tz
  )

  // End = midnight of (to + 1 day) so the range is inclusive of "to".
  const dayAfter = new Date(
    Date.UTC(toParts.year, toParts.month - 1, toParts.day + 1)
  )
  const endUtc = utcMidnightFor(
    dayAfter.getUTCFullYear(),
    dayAfter.getUTCMonth() + 1,
    dayAfter.getUTCDate(),
    tz
  )

  return { start: startUtc.toISOString(), end: endUtc.toISOString() }
}

// ─── Presets ───────────────────────────────────────────────────────────────

function startOfWeekMonday(year: number, month: number, day: number): {
  year: number
  month: number
  day: number
} {
  // JS getUTCDay(): 0 = Sunday … 6 = Saturday. We want Monday = 0.
  const d = new Date(Date.UTC(year, month - 1, day))
  const dow = (d.getUTCDay() + 6) % 7 // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

/**
 * Compute the active date range for a preset in the user's timezone.
 * Returns date-only strings (YYYY-MM-DD); convert to UTC bounds via
 * `dateOnlyRangeToUtc`.
 */
export function getPresetRange(
  preset: Exclude<DateRangePreset, "custom">,
  timezone: string,
  now: Date = new Date()
): { from: string; to: string } {
  const tz = timezone || DEFAULT_TIMEZONE
  const today = ymdInTimezone(now, tz)
  const { year, month, day } = today

  switch (preset) {
    case "today":
      return { from: formatYmd(year, month, day), to: formatYmd(year, month, day) }

    case "next7": {
      // Hoy hasta hoy + 6 (7 días en total, inclusive)
      const endProbe = new Date(Date.UTC(year, month - 1, day + 6))
      return {
        from: formatYmd(year, month, day),
        to: formatYmd(
          endProbe.getUTCFullYear(),
          endProbe.getUTCMonth() + 1,
          endProbe.getUTCDate()
        ),
      }
    }

    case "next30": {
      // Hoy hasta hoy + 29 (30 días en total)
      const endProbe = new Date(Date.UTC(year, month - 1, day + 29))
      return {
        from: formatYmd(year, month, day),
        to: formatYmd(
          endProbe.getUTCFullYear(),
          endProbe.getUTCMonth() + 1,
          endProbe.getUTCDate()
        ),
      }
    }

    case "last7": {
      // Hoy - 6 hasta hoy (7 días en total)
      const startProbe = new Date(Date.UTC(year, month - 1, day - 6))
      return {
        from: formatYmd(
          startProbe.getUTCFullYear(),
          startProbe.getUTCMonth() + 1,
          startProbe.getUTCDate()
        ),
        to: formatYmd(year, month, day),
      }
    }

    case "last30": {
      // Hoy - 29 hasta hoy (30 días en total)
      const startProbe = new Date(Date.UTC(year, month - 1, day - 29))
      return {
        from: formatYmd(
          startProbe.getUTCFullYear(),
          startProbe.getUTCMonth() + 1,
          startProbe.getUTCDate()
        ),
        to: formatYmd(year, month, day),
      }
    }

    case "thisWeek": {
      const start = startOfWeekMonday(year, month, day)
      // End of week = start + 6 days
      const endProbe = new Date(
        Date.UTC(start.year, start.month - 1, start.day + 6)
      )
      return {
        from: formatYmd(start.year, start.month, start.day),
        to: formatYmd(
          endProbe.getUTCFullYear(),
          endProbe.getUTCMonth() + 1,
          endProbe.getUTCDate()
        ),
      }
    }

    case "thisMonth": {
      // Last day of current month = day 0 of next month.
      const endProbe = new Date(Date.UTC(year, month, 0))
      return {
        from: formatYmd(year, month, 1),
        to: formatYmd(year, month, endProbe.getUTCDate()),
      }
    }

    case "lastMonth": {
      // Previous month: month-1, handle January→December rollover.
      const prevMonthDate = new Date(Date.UTC(year, month - 2, 1))
      const py = prevMonthDate.getUTCFullYear()
      const pm = prevMonthDate.getUTCMonth() + 1
      const lastDayProbe = new Date(Date.UTC(py, pm, 0))
      return {
        from: formatYmd(py, pm, 1),
        to: formatYmd(py, pm, lastDayProbe.getUTCDate()),
      }
    }

    case "thisQuarter": {
      const qIndex = Math.floor((month - 1) / 3) // 0..3
      const startMonth = qIndex * 3 + 1
      const endMonth = startMonth + 2
      const lastDayProbe = new Date(Date.UTC(year, endMonth, 0))
      return {
        from: formatYmd(year, startMonth, 1),
        to: formatYmd(year, endMonth, lastDayProbe.getUTCDate()),
      }
    }

    case "thisYear":
      return { from: formatYmd(year, 1, 1), to: formatYmd(year, 12, 31) }
  }
}

// ─── searchParams parsing ─────────────────────────────────────────────────

export type DashboardSearchParams = {
  from?: string | string[] | undefined
  to?: string | string[] | undefined
  preset?: string | string[] | undefined
}

const PRESETS = new Set<DateRangePreset>([
  "today",
  "next7",
  "next30",
  "last7",
  "last30",
  "thisWeek",
  "thisMonth",
  "lastMonth",
  "thisQuarter",
  "thisYear",
  "custom",
])

function firstString(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

/**
 * Resolve the active range from URL searchParams. Falls back to "thisMonth"
 * if params are missing or invalid.
 */
export function resolveActiveRange(
  searchParams: DashboardSearchParams,
  timezone: string,
  now: Date = new Date()
): ActiveDateRange {
  const from = firstString(searchParams.from)
  const to = firstString(searchParams.to)
  const presetRaw = firstString(searchParams.preset)

  if (from && to && isValidYmd(from) && isValidYmd(to) && from <= to) {
    const preset: DateRangePreset =
      presetRaw && PRESETS.has(presetRaw as DateRangePreset)
        ? (presetRaw as DateRangePreset)
        : "custom"
    return { from, to, preset }
  }

  // No (or invalid) params → default to "thisMonth".
  const r = getPresetRange("thisMonth", timezone, now)
  return { from: r.from, to: r.to, preset: "thisMonth" }
}

// ─── Formatting ───────────────────────────────────────────────────────────

/**
 * Format a date-only string as a human-readable date using the active locale.
 * Parses the YYYY-MM-DD as a calendar date (no TZ shift in the output).
 */
export function formatYmdForDisplay(value: string, locale: string): string {
  const parts = ymdToParts(value)
  if (!parts) return value
  // Use UTC midnight as the anchor and format with timeZone: "UTC" so the
  // calendar date is preserved regardless of the runtime's TZ.
  const d = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0)
  )
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d)
}
