import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

/**
 * Consultas de la bandeja unificada (/mensajes).
 *
 * Una CONVERSACIÓN es (marca, canal, contraparte), donde la contraparte es el
 * lead si el mensaje se pudo vincular, y si no, el número crudo. Eso es lo que
 * hace visible el caso que hoy se pierde: alguien que todavía no es paciente
 * escribe, el mensaje se guarda con su marca… y ninguna pantalla lo muestra.
 *
 * El agrupado se hace en TypeScript sobre una consulta ACOTADA (ver DEFAULTS),
 * no con una vista nueva: la tabla `messages` ya trae RLS por marca y no vale la
 * pena una vista con `security_invoker` para el volumen de una clínica. Si algún
 * día no alcanza, esto se cambia por un RPC — el corte es explícito y la UI
 * avisa cuando se topó con el límite, no se traga conversaciones en silencio.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

/** Ventana y tope por defecto de la consulta que alimenta la bandeja. */
export const THREAD_DEFAULTS = { days: 90, limit: 2000 } as const

export type ThreadChannel = "sms" | "whatsapp"

export type ThreadSummary = {
  /** Identidad estable de la conversación: `lead:<uuid>:<canal>` o `num:<e164>:<canal>`. */
  key: string
  brandId: string | null
  brandName: string | null
  channel: ThreadChannel
  leadId: string | null
  leadName: string | null
  /** Teléfono del paciente (o del desconocido que escribió). */
  counterpart: string | null
  lastBody: string | null
  lastDirection: "in" | "out"
  lastAt: string
  unread: number
  total: number
}

export type ThreadMessage = {
  id: string
  direction: "in" | "out"
  body: string | null
  status: string | null
  created_at: string
  channel: string | null
  read_at: string | null
}

type RawRow = {
  id: string
  brand_id: string | null
  lead_id: string | null
  channel: string | null
  direction: "in" | "out"
  body: string | null
  status: string | null
  created_at: string
  read_at: string | null
  from_number: string | null
  to_number: string | null
  lead?: { id: string; first_name: string; last_name: string | null } | null
  brand?: { id: string; name: string } | null
}

const SELECT =
  "id, brand_id, lead_id, channel, direction, body, status, created_at, read_at, " +
  "from_number, to_number, lead:leads(id, first_name, last_name), brand:brands(id, name)"

/** El número de la OTRA persona: en un entrante es quien escribe; en un saliente, a quién. */
function counterpartOf(r: RawRow): string | null {
  return r.direction === "in" ? r.from_number : r.to_number
}

function channelOf(r: RawRow): ThreadChannel {
  // Las filas viejas (previas a WhatsApp) no traen channel: son SMS.
  return r.channel === "whatsapp" ? "whatsapp" : "sms"
}

export function threadKey(args: {
  leadId: string | null
  counterpart: string | null
  channel: ThreadChannel
}): string {
  return args.leadId
    ? `lead:${args.leadId}:${args.channel}`
    : `num:${args.counterpart ?? "desconocido"}:${args.channel}`
}

function nameOf(r: RawRow): string | null {
  if (!r.lead) return null
  return [r.lead.first_name, r.lead.last_name].filter(Boolean).join(" ").trim() || null
}

export type ThreadsResult = {
  threads: ThreadSummary[]
  /** true si la consulta se topó con el tope → hay conversaciones más viejas sin listar. */
  truncated: boolean
  /**
   * Mensaje de error si la consulta falló. Existe para NO mentirle al usuario:
   * si falta correr la migración (`read_at`), sin esto la bandeja se vería
   * simplemente "vacía" y parecería rota en vez de decir qué falta.
   */
  error?: string
}

/**
 * Conversaciones de la bandeja. `brandId` null = todas las marcas a las que el
 * usuario tiene acceso (la RLS de `messages` ya lo acota; no hay bypass aquí).
 */
export async function fetchThreads(
  sb: SupabaseClient<Database>,
  opts: {
    brandId?: string | null
    days?: number
    limit?: number
    /**
     * Solo mensajes SIN marca atribuida. La RLS los esconde de todos, así que
     * esto SOLO se llama con el admin client y tras verificar rol admin — si no,
     * quedan enterrados para siempre.
     */
    onlyUnbranded?: boolean
  } = {},
): Promise<ThreadsResult> {
  const days = opts.days ?? THREAD_DEFAULTS.days
  const limit = opts.limit ?? THREAD_DEFAULTS.limit
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  let q = (sb as AnyClient)
    .from("messages")
    .select(SELECT)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (opts.onlyUnbranded) q = q.is("brand_id", null)
  else if (opts.brandId) q = q.eq("brand_id", opts.brandId)

  const { data, error } = await q
  if (error) {
    console.error("[messages] fetchThreads:", error.message)
    const falta = /read_at|column .* does not exist/i.test(error.message)
    return {
      threads: [],
      truncated: false,
      error: falta
        ? "Falta correr docs/sql/2026-08-25-bandeja.sql en Supabase (la columna read_at todavía no existe)."
        : "No se pudieron cargar las conversaciones.",
    }
  }
  const rows = (data ?? []) as RawRow[]

  // Las filas vienen de la más nueva a la más vieja, así que la PRIMERA que se
  // ve de cada conversación es su último mensaje.
  const map = new Map<string, ThreadSummary>()
  for (const r of rows) {
    const channel = channelOf(r)
    const counterpart = counterpartOf(r)
    const key = threadKey({ leadId: r.lead_id, counterpart, channel })
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        key,
        brandId: r.brand_id,
        brandName: r.brand?.name ?? null,
        channel,
        leadId: r.lead_id,
        leadName: nameOf(r),
        counterpart,
        lastBody: r.body,
        lastDirection: r.direction,
        lastAt: r.created_at,
        unread: r.direction === "in" && !r.read_at ? 1 : 0,
        total: 1,
      })
      continue
    }
    existing.total += 1
    if (r.direction === "in" && !r.read_at) existing.unread += 1
    // El nombre puede venir en una fila y no en otra (salientes viejos); lo conservamos.
    if (!existing.leadName) existing.leadName = nameOf(r)
    if (!existing.brandName) existing.brandName = r.brand?.name ?? null
  }

  const threads = Array.from(map.values()).sort(
    (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime(),
  )
  return { threads, truncated: rows.length >= limit }
}

/** Mensajes de UNA conversación, del más viejo al más nuevo (orden de lectura). */
export async function fetchThreadMessages(
  sb: SupabaseClient<Database>,
  opts: {
    channel: ThreadChannel
    leadId?: string | null
    counterpart?: string | null
    brandId?: string | null
    /** Conversación del bucket "Sin marca": acota a brand_id null, no a "cualquiera". */
    unbranded?: boolean
    limit?: number
  },
): Promise<ThreadMessage[]> {
  let q = (sb as AnyClient)
    .from("messages")
    .select("id, direction, body, status, created_at, channel, read_at")
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 200)

  // `channel` es NOT NULL DEFAULT 'sms' desde la migración 2026-07-30, así que
  // las filas viejas ya dicen 'sms'. Un `eq` basta — nada de OR con null.
  q = q.eq("channel", opts.channel)

  if (opts.leadId) {
    q = q.eq("lead_id", opts.leadId)
  } else if (opts.counterpart) {
    // Conversación sin lead: se identifica por el número, en cualquier dirección.
    q = q.is("lead_id", null).or(`from_number.eq.${opts.counterpart},to_number.eq.${opts.counterpart}`)
  } else {
    return []
  }
  if (opts.unbranded) q = q.is("brand_id", null)
  else if (opts.brandId) q = q.eq("brand_id", opts.brandId)

  const { data, error } = await q
  if (error) {
    console.error("[messages] fetchThreadMessages:", error.message)
    return []
  }
  return (data ?? []) as ThreadMessage[]
}

/** Cuántos entrantes sin leer ve el usuario (badge del sidebar). */
export async function countUnread(
  sb: SupabaseClient<Database>,
  brandId?: string | null,
): Promise<number> {
  let q = (sb as AnyClient)
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "in")
    .is("read_at", null)
  if (brandId) q = q.eq("brand_id", brandId)
  const { count, error } = await q
  if (error) return 0
  return count ?? 0
}
