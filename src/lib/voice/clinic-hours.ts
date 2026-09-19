/**
 * Horario de la clínica de 726 S. Main (Si Se Pierde y La Esperanza), confirmado
 * por Roberto: lunes a viernes 9:00 am–7:00 pm · sábado 10:00 am–2:00 pm ·
 * domingo cerrado.
 *
 * Se valida en el servidor y no solo en el prompt: el bot puede equivocarse y
 * ofrecer un domingo o las 3 de la tarde de un sábado; la base no debe aceptarlo.
 *
 * La cita tiene que TERMINAR a la hora de cierre. Con citas de 30 minutos, la
 * última del sábado es a la 1:30 pm y la última entre semana a las 6:30 pm.
 * Las marcas que no aparecen aquí no se validan.
 */

export const APPT_MINUTES = 30

type Window = readonly [number, number] // [abre, cierra] en minutos desde medianoche

const WEEKDAY: Window = [9 * 60, 19 * 60]
const SATURDAY: Window = [10 * 60, 14 * 60]

// Índice = día de la semana en California (0 = domingo … 6 = sábado). null = cerrado.
const CLINIC_726_MAIN: ReadonlyArray<Window | null> = [
  null, WEEKDAY, WEEKDAY, WEEKDAY, WEEKDAY, WEEKDAY, SATURDAY,
]

const HOURS_BY_BRAND: Record<string, ReadonlyArray<Window | null>> = {
  "si-se-pierde": CLINIC_726_MAIN,
  "la-esperanza": CLINIC_726_MAIN,
}

const HORARIO =
  "Horario: lunes a viernes 9:00 am a 7:00 pm; sábado 10:00 am a 2:00 pm " +
  "(la última cita del sábado es a la 1:30 pm); domingo cerrado."

/** Día de la semana y minutos desde medianoche, en hora de California. */
function pacificParts(d: Date): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"))
  return { dow, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) }
}

/**
 * null = la cita cabe en el horario. Si no cabe, devuelve el motivo en palabras
 * que el bot puede usar para ofrecer otra hora.
 */
export function outsideClinicHours(brandSlug: string, when: Date): string | null {
  const week = HOURS_BY_BRAND[brandSlug]
  if (!week) return null
  const { dow, minutes } = pacificParts(when)
  const window = week[dow]
  if (!window) return `La clínica está cerrada ese día. ${HORARIO} Ofrece otro día.`
  const [open, close] = window
  if (minutes < open || minutes + APPT_MINUTES > close) {
    return `Esa hora está fuera del horario de la clínica. ${HORARIO} Ofrece una hora dentro del horario.`
  }
  return null
}
