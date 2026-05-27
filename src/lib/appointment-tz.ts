/**
 * Timezone helpers para citas. TODAS las citas se ven y editan en la zona
 * horaria del brand (clínica), no en la del navegador del editor.
 *
 * Si no fijáramos esto, un admin en EST abriendo una cita creada por un rep
 * en PST sufriría corrupción silenciosa al guardar (el round-trip aplica un
 * offset distinto y desfasa scheduled_at en la DB).
 */

export const BRAND_TZ = "America/Los_Angeles"

/**
 * ISO UTC → "YYYY-MM-DDTHH:mm" en BRAND_TZ (formato datetime-local input).
 * Independiente de la timezone del navegador.
 */
export function isoToBrandLocal(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAND_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00"
  let hour = get("hour")
  if (hour === "24") hour = "00"
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`
}

/**
 * "YYYY-MM-DDTHH:mm" (interpretado en BRAND_TZ) → ISO UTC.
 * Itera hasta encontrar el UTC tal que, al formatearlo en BRAND_TZ, dé el
 * wall-clock pedido. Maneja DST correctamente.
 */
export function brandLocalToIso(local: string): string {
  if (!local) return ""
  const [datePart, timePart] = local.split("T")
  if (!datePart || !timePart) return ""
  const [y, mo, d] = datePart.split("-").map((n) => parseInt(n, 10))
  const [h, mi] = timePart.split(":").map((n) => parseInt(n, 10))
  if ([y, mo, d, h, mi].some((n) => isNaN(n))) return ""

  let utc = Date.UTC(y, mo - 1, d, h, mi, 0, 0)
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: BRAND_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(utc))
    const getN = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10)
    let seenH = getN("hour")
    if (seenH === 24) seenH = 0
    const seenWall = Date.UTC(getN("year"), getN("month") - 1, getN("day"), seenH, getN("minute"), getN("second"), 0)
    const targetWall = Date.UTC(y, mo - 1, d, h, mi, 0, 0)
    const drift = seenWall - targetWall
    if (drift === 0) break
    utc -= drift
  }
  return new Date(utc).toISOString()
}
