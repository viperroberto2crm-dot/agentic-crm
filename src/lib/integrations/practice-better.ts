// Practice Better API client (OAuth2 Client Credentials).
// Docs: https://api-docs.practicebetter.io  ·  Base: https://api.practicebetter.io
//
// Auth: intercambiamos client_id + client_secret por un access_token temporal
// vía POST /oauth2/token, y lo cacheamos en memoria del módulo hasta que expira.
// Rate limit del proveedor: 5 req/s, 10,000/día — por eso el polling es espaciado.
//
// Diseño defensivo: ninguna función lanza hacia el caller del cron sin contexto;
// los errores se propagan con mensajes claros para loguear.

const PB_BASE = process.env.PRACTICE_BETTER_BASE_URL ?? "https://api.practicebetter.io"

export class MissingPbCredentialsError extends Error {
  constructor() {
    super("PRACTICE_BETTER_CLIENT_ID / PRACTICE_BETTER_CLIENT_SECRET no configuradas")
    this.name = "MissingPbCredentialsError"
  }
}

// ── Token cache (en memoria del módulo) ──────────────────────────────────────
let cachedToken: { token: string; expiresAtMs: number } | null = null

type TokenResponse = {
  access_token: string
  token_type?: string
  expires_in?: number // segundos
  scope?: string
}

/**
 * Obtiene un access token válido, reusando el cacheado si aún no expira.
 * Renueva 60s antes de la expiración real para evitar carreras.
 */
export async function getPbAccessToken(): Promise<string> {
  const clientId = process.env.PRACTICE_BETTER_CLIENT_ID
  const clientSecret = process.env.PRACTICE_BETTER_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new MissingPbCredentialsError()

  const nowMs = Date.now()
  if (cachedToken && cachedToken.expiresAtMs > nowMs + 60_000) {
    return cachedToken.token
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "read write",
  })

  const res = await fetch(`${PB_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`PB token error ${res.status}: ${text.slice(0, 300)}`)
  }

  const json = (await res.json()) as TokenResponse
  if (!json.access_token) throw new Error("PB token response sin access_token")

  const ttlSec = json.expires_in ?? 3600
  cachedToken = {
    token: json.access_token,
    expiresAtMs: nowMs + ttlSec * 1000,
  }
  return cachedToken.token
}

// ── Fetch helper autenticado ─────────────────────────────────────────────────
async function pbFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getPbAccessToken()
  const res = await fetch(`${PB_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`PB ${init?.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  }
  // 204 No Content
  if (res.status === 204) return undefined as unknown as T
  return (await res.json()) as T
}

// ── Tipos (parciales, según api-docs.practicebetter.io) ──────────────────────
// La API está en beta; estos tipos cubren lo que usamos y son tolerantes a
// campos extra. Se ajustan cuando veamos respuestas reales en el polling.

export type PbRecord = {
  id?: string
  _id?: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  mobile?: string
  [k: string]: unknown
}

export type PbInvoice = {
  id?: string
  _id?: string
  recordId?: string
  clientId?: string
  status?: string
  total?: number
  amount?: number
  currency?: string
  paidDate?: string
  date?: string
  number?: string
  [k: string]: unknown
}

export type PbPackageInstance = {
  id?: string
  _id?: string
  recordId?: string
  clientId?: string
  name?: string
  status?: string
  startDate?: string
  scheduledAt?: string
  [k: string]: unknown
}

export type PbAvailabilitySlot = {
  start?: string
  end?: string
  consultantId?: string
  [k: string]: unknown
}

// ── Paginación ───────────────────────────────────────────────────────────────
// PB devuelve { count, hasMore, items: [...] }. Recorremos todas las páginas
// con skip/limit hasta agotar (hasMore=false), con un tope de seguridad.

type PbPage<T> = { count?: number; hasMore?: boolean; items?: T[] }

async function listAllPaged<T>(path: string, query?: Record<string, string>): Promise<T[]> {
  const out: T[] = []
  const limit = 100
  const maxPages = 50 // tope de seguridad (5,000 items)
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ ...query, skip: String(page * limit), limit: String(limit) })
    const data = await pbFetch<PbPage<T> | T[]>(`${path}?${params.toString()}`)
    const items = Array.isArray(data) ? data : data.items ?? []
    out.push(...items)
    const hasMore = Array.isArray(data) ? items.length === limit : Boolean(data.hasMore)
    if (!hasMore || items.length === 0) break
  }
  return out
}

// ── Endpoints que usaremos ───────────────────────────────────────────────────

/** Crea un cliente (record) en Practice Better. Devuelve el record creado. */
export async function createPbRecord(input: {
  firstName: string
  lastName?: string
  email?: string
  phone?: string
}): Promise<PbRecord> {
  return pbFetch<PbRecord>("/consultant/records", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

/** Lista records (clientes), todas las páginas. */
export async function listPbRecords(query?: Record<string, string>): Promise<PbRecord[]> {
  return listAllPaged<PbRecord>("/consultant/records", query)
}

/** Lista invoices (pagos), todas las páginas. */
export async function listPbInvoices(query?: Record<string, string>): Promise<PbInvoice[]> {
  return listAllPaged<PbInvoice>("/consultant/payments/invoices", query)
}

/** Lista package instances (sesiones/programas ≈ citas), todas las páginas. */
export async function listPbPackages(query?: Record<string, string>): Promise<PbPackageInstance[]> {
  return listAllPaged<PbPackageInstance>("/consultant/packages/instances", query)
}

/** Consulta slots de disponibilidad del consultant (para agendar desde el CRM). */
export async function listPbAvailability(
  query?: Record<string, string>,
): Promise<PbAvailabilitySlot[]> {
  const qs = query ? `?${new URLSearchParams(query).toString()}` : ""
  const data = await pbFetch<PbAvailabilitySlot[] | { items?: PbAvailabilitySlot[]; slots?: PbAvailabilitySlot[] }>(
    `/consultant/availability/slots${qs}`,
  )
  if (Array.isArray(data)) return data
  return data.items ?? data.slots ?? []
}

/** Normaliza el id de un objeto PB (a veces `id`, a veces `_id`). */
export function pbId(obj: { id?: string; _id?: string } | null | undefined): string | null {
  return obj?.id ?? obj?._id ?? null
}

/** DIAGNÓSTICO: devuelve la respuesta cruda de un path GET (solo lectura). */
export async function pbRawGet(path: string): Promise<unknown> {
  return pbFetch<unknown>(path)
}
