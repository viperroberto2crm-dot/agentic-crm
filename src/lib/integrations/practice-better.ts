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
  // 204 No Content o body vacío (ej. DELETE) → no intentar parsear JSON
  if (res.status === 204) return undefined as unknown as T
  const text = await res.text()
  if (!text) return undefined as unknown as T
  return JSON.parse(text) as T
}

// ── Tipos (parciales, según api-docs.practicebetter.io) ──────────────────────
// La API está en beta; estos tipos cubren lo que usamos y son tolerantes a
// campos extra. Se ajustan cuando veamos respuestas reales en el polling.

// Estructura real confirmada vía debug 2026-06-10.
type PbMoney = { amount?: number; currency?: string }
type PbProfile = { firstName?: string; lastName?: string; emailAddress?: string }
type PbClientRecord = { id?: string; profile?: PbProfile }

export type PbRecord = {
  id?: string
  profile?: PbProfile
  client?: { id?: string; emailAddress?: string }
  isActive?: boolean
  status?: string
  [k: string]: unknown
}

export type PbInvoice = {
  id?: string
  clientRecord?: PbClientRecord
  invoiceNumber?: string
  invoiceDate?: string
  dateModified?: string
  paid?: boolean
  paymentStatus?: string
  currency?: string
  total?: PbMoney
  amountPaid?: PbMoney
  [k: string]: unknown
}

export type PbPackageInstance = {
  id?: string
  name?: string
  clientRecord?: PbClientRecord
  confirmationStatus?: string
  paymentStatus?: string
  confirmed?: boolean
  dateCreated?: string
  dateModified?: string
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

// Dirección estructurada tal como la espera PB (schema `Address`, confirmado en
// swagger). country = ISO Alpha-2. Sin campos city/state/zip → locality/region/postalCode.
export type PbAddress = {
  street?: string | null
  unit?: string | null
  floor?: string | null
  locality?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
}

/** Limpia una PbAddress: quita nulls/vacíos. null si no queda ningún campo. */
function cleanAddress(a: PbAddress | null | undefined): Record<string, string> | null {
  if (!a) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(a)) {
    const s = typeof v === "string" ? v.trim() : ""
    if (s) out[k] = s
  }
  return Object.keys(out).length ? out : null
}

/** Crea un cliente (record) en Practice Better. Devuelve el record creado. */
export async function createPbRecord(input: {
  firstName: string
  lastName?: string
  email?: string
  phone?: string
  address?: PbAddress | null
  notes?: string | null
}): Promise<PbRecord> {
  // PB espera los datos dentro de un objeto `profile`. Campos exactos confirmados
  // en el swagger: email = emailAddress, teléfono celular = mobilePhone (NO
  // phoneNumber, que no existe en el schema y se ignora/rechaza), address = objeto.
  const profile: Record<string, unknown> = { firstName: input.firstName }
  if (input.lastName) profile.lastName = input.lastName
  if (input.email) profile.emailAddress = input.email
  if (input.phone) profile.mobilePhone = input.phone
  const addr = cleanAddress(input.address)
  if (addr) profile.address = addr
  if (input.notes && input.notes.trim()) profile.notes = input.notes.trim()
  return pbFetch<PbRecord>("/consultant/records", {
    method: "POST",
    body: JSON.stringify({ profile }),
  })
}

/** Obtiene un record por id (para enriquecer sin borrar: PUT de PB es REPLACE total). */
export async function getPbRecord(recordId: string): Promise<PbRecord | null> {
  try {
    const rec = await pbFetch<PbRecord>(`/consultant/records/${recordId}`)
    return rec ?? null
  } catch {
    return null
  }
}

/**
 * Enriquece un record EXISTENTE de forma segura. El PUT de PB es REPLACE TOTAL
 * ("los campos que falten se borran"), así que:
 *   1) GET del record completo,
 *   2) rellenamos SOLO campos de dirección vacíos (no pisar lo que el médico editó),
 *   3) ANEXAMOS la nota (no reemplazamos las notas existentes),
 *   4) PUT del record ENTERO (firstName/lastName/email se conservan tal cual).
 * Devuelve true si se hizo un PUT (hubo algo que agregar). No lanza.
 */
export async function enrichPbRecord(
  recordId: string,
  input: { address?: PbAddress | null; appendNote?: string | null },
): Promise<boolean> {
  const rec = await getPbRecord(recordId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile: any = rec?.profile
  if (!profile || !profile.firstName || !profile.lastName || !profile.emailAddress) {
    // Sin los 3 required no podemos PUT sin romper el record → abortar seguro.
    return false
  }
  let changed = false

  // (2) Dirección: solo si PB no tiene ninguna y nosotros sí traemos algo.
  const newAddr = cleanAddress(input.address)
  const existingAddr = cleanAddress(profile.address as PbAddress | null)
  if (newAddr && !existingAddr) {
    profile.address = newAddr
    changed = true
  }

  // (3) Nota: anexar solo si su TOKEN estable ([tx …]/[booking …]) no está ya
  // en las notas. Dedup por token, no por string completo: payment.updated /
  // booking.updated cambian monto/fecha (string distinto) para la MISMA
  // transacción → dedup por string duplicaría. El token con el id es estable.
  const note = input.appendNote?.trim()
  if (note) {
    const prev = typeof profile.notes === "string" ? profile.notes : ""
    const token = note.match(/\[(?:tx|booking|intake) [^\]]+\]/)?.[0] ?? note
    if (!prev.includes(token)) {
      profile.notes = prev ? `${prev}\n${note}` : note
      changed = true
    }
  }

  if (!changed) return false

  // (4) PUT del record ENTERO. El PUT de PB es REPLACE total: lo que no reenvíes
  // se borra. Por eso hacemos ECHO del record completo del GET (con profile ya
  // mutado en memoria) y solo quitamos campos read-only/servidor. Así NO se
  // pierde nada que el médico haya editado (tags, seguro, DOB, etc.).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = { ...(rec as any) }
  delete body.id
  delete body._id
  delete body.dateCreated
  delete body.dateModified
  body.profile = profile
  await pbFetch<PbRecord>(`/consultant/records/${recordId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  })
  return true
}

/** Borra un record (cliente) de Practice Better por id. */
export async function deletePbRecord(recordId: string): Promise<void> {
  await pbFetch<unknown>(`/consultant/records/${recordId}`, { method: "DELETE" })
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

// ── Servicios y sesiones (Fase 3) ────────────────────────────────────────────
// PB permite crear la cita como "sesión". serviceType enum EXACTO (swagger):
// 'face' | 'phone' | 'virtual'. Si 'virtual' hay que setear telehealthSettings.

export type PbService = {
  id?: string
  name?: string
  duration?: number // minutos
  serviceTypes?: string[]
  [k: string]: unknown
}

export type PbSessionType = "face" | "phone" | "virtual"

export type PbMoneyInput = { amount: number; currency: string } // amount en CENTAVOS

export type CreatePbSessionInput = {
  clientRecordId: string
  serviceId: string
  serviceType: PbSessionType
  sessionDate: string // ISO 8601 date-time (RFC3339 con offset)
  duration: number // minutos
  fee?: PbMoneyInput | null
  notes?: string | null
  notify?: boolean // default false: PB no manda su propio email (Square ya avisó)
  markConfirmed?: boolean // default true: la cita ya está confirmada en Square
  ignoreConflict?: boolean
  timeZone?: string | null
  /** Para serviceType 'virtual': 'zoom' | 'system' (telehealth PB) | 'other'. */
  telehealthLaunch?: string
}

export type PbSession = { id?: string; _id?: string; [k: string]: unknown }

/** Lista los servicios del consultant (para la pantalla de mapeo Square→PB). */
export async function listPbServices(): Promise<PbService[]> {
  return listAllPaged<PbService>("/consultant/services")
}

/** Crea una sesión (cita) en PB. Devuelve la sesión creada (con id). */
export async function createPbSession(input: CreatePbSessionInput): Promise<PbSession> {
  const body: Record<string, unknown> = {
    clientRecordId: input.clientRecordId,
    serviceId: input.serviceId,
    serviceType: input.serviceType,
    sessionDate: input.sessionDate,
    duration: input.duration,
    notify: input.notify ?? false,
    markConfirmed: input.markConfirmed ?? true,
  }
  if (input.fee && typeof input.fee.amount === "number") body.fee = input.fee
  if (input.notes && input.notes.trim()) body.notes = input.notes.trim()
  if (input.ignoreConflict) body.ignoreConflict = true
  if (input.timeZone) body.timeZone = input.timeZone
  if (input.serviceType === "virtual") {
    body.telehealthSettings = { launchApplication: input.telehealthLaunch ?? "system" }
  }
  return pbFetch<PbSession>("/consultant/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

/** Reagenda una sesión (booking.updated): PUT /consultant/sessions/{id}/date. No lanza. */
export async function updatePbSessionDate(
  sessionId: string,
  input: { sessionDate: string; duration?: number },
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { sessionDate: input.sessionDate }
    if (typeof input.duration === "number") body.duration = input.duration
    await pbFetch<PbSession>(`/consultant/sessions/${sessionId}/date`, {
      method: "PUT",
      body: JSON.stringify(body),
    })
    return true
  } catch {
    return false
  }
}

/** Cancela una sesión en PB: POST /consultant/sessions/{id}/cancel. No lanza. */
export async function cancelPbSession(sessionId: string): Promise<boolean> {
  try {
    await pbFetch<PbSession>(`/consultant/sessions/${sessionId}/cancel`, { method: "POST" })
    return true
  } catch {
    return false
  }
}
