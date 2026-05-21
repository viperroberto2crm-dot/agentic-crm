/**
 * 800.com Integration — call tracking adapter.
 *
 * Architecture decision (2026-05-20): the v1 endpoint `GET /calls` filters
 * results to calls owned/answered by the API key's user. This means our
 * admin key (Willfred Gibbons, Account Owner) does NOT see calls answered
 * by forwarding destinations (e.g. SSP call center reps). Confirmed by
 * cross-referencing the dashboard Inbox vs API output.
 *
 * Solution: use `GET /v2/calls?companyId=...&startDate&endDate` which
 * returns ALL calls in the company regardless of who answered. Paginate
 * via meta.nextCursor.
 *
 * This module is the only place that talks to 800.com — the rest of the
 * CRM consumes the normalized shape (CrmCallRow) and the persistence
 * layer in `importCallsToCrm()`.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type DB = SupabaseClient<Database>

const API_BASE = "https://api.800.com"

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Shape returned by 800.com /v2/calls (subset of fields we use).
 * Confirmed via curl probe on 2026-05-20.
 */
export type EightHundredCallV2 = {
  id: number
  parentId: number | null
  caller: string         // E.164
  dialed: string         // E.164
  direction: "inbound" | "outbound"
  status: string         // "hungup" | "answered" | ...
  startedAt: string      // ISO
  endedAt: string | null
  answeredAt: string | null
  forwardNumber: string
  number: {
    id: number           // matches tracking_numbers.provider_metadata.number_id
    number: string       // E.164
    label: string | null
    tags: Array<{ id: number; label: string }>
  }
  answeredBy: string | null
  ringDuration: number
  duration: number       // seconds, talk time
  billableDuration: number
  disconnectCause: string
  disconnectCauseMessage: string
  result: number
  // Optional fields that appear on some endpoints / call details
  recordingUrl?: string | null
  voicemailUrl?: string | null
  // CNAM / caller name — el field name exacto varía. Probamos varios:
  callerName?: string | null
  caller_name?: string | null
  contactName?: string | null
  contact_name?: string | null
  contact?: { name?: string | null; firstName?: string | null; lastName?: string | null } | null
}

/**
 * Extrae el nombre del caller probando varios fields posibles de la respuesta
 * 800.com. Devuelve { firstName, lastName } parseando el nombre completo si es
 * necesario.
 */
export function extractCallerName(call: EightHundredCallV2): {
  firstName: string | null
  lastName: string | null
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (call as any).callerName
    ?? (call as any).caller_name
    ?? (call as any).contactName
    ?? (call as any).contact_name
    ?? (call as any).contact?.name
    ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const firstFromObj = (call as any).contact?.firstName ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastFromObj = (call as any).contact?.lastName ?? null
  if (firstFromObj || lastFromObj) {
    return { firstName: firstFromObj, lastName: lastFromObj }
  }
  if (!raw || typeof raw !== "string") return { firstName: null, lastName: null }
  const trimmed = raw.trim()
  if (!trimmed) return { firstName: null, lastName: null }
  // No usar si el "nombre" es solo dígitos (es el teléfono)
  if (/^\+?\d[\d\s().-]*$/.test(trimmed)) return { firstName: null, lastName: null }
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: null }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") }
}

export type EightHundredListResponse = {
  data: EightHundredCallV2[]
  meta: {
    nextCursor: string | null
    prevCursor: string | null
  }
}

export type ListCallsOptions = {
  companyId: number
  startDate?: string  // ISO; default = 30 days ago
  endDate?: string    // ISO; default = now
  perPage?: number    // default 100, max 100
  cursor?: string
}

// ── Low-level client ─────────────────────────────────────────────────────────

function getAuthHeader(): string {
  const key = process.env.EIGHTHUNDRED_API_KEY
  if (!key) throw new Error("EIGHTHUNDRED_API_KEY not configured")
  return `Bearer ${key}`
}

function getCompanyId(): number {
  const id = process.env.EIGHTHUNDRED_COMPANY_ID
  if (!id) throw new Error("EIGHTHUNDRED_COMPANY_ID not configured")
  const n = parseInt(id, 10)
  if (Number.isNaN(n)) throw new Error("EIGHTHUNDRED_COMPANY_ID must be a number")
  return n
}

/**
 * Fetch one page of calls from /v2/calls. Use the returned cursor to paginate.
 * Respects 800.com rate limit (60 req/min) — caller responsible for spacing.
 */
export async function listCallsPage(
  opts: ListCallsOptions,
): Promise<EightHundredListResponse> {
  const params = new URLSearchParams()
  params.set("companyId", String(opts.companyId))
  params.set("perPage", String(opts.perPage ?? 100))
  if (opts.startDate) params.set("startDate", opts.startDate)
  if (opts.endDate) params.set("endDate", opts.endDate)
  if (opts.cursor) params.set("cursor", opts.cursor)

  const url = `${API_BASE}/v2/calls?${params.toString()}`
  const res = await fetch(url, {
    headers: {
      authorization: getAuthHeader(),
      accept: "application/json",
    },
    // Vercel: ensure no cache between cron runs
    cache: "no-store",
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`800.com /v2/calls ${res.status}: ${body.slice(0, 300)}`)
  }

  return (await res.json()) as EightHundredListResponse
}

/**
 * Iterate ALL calls across pages with cursor pagination.
 * Yields each call. Caller controls termination (e.g. break after seeing
 * already-imported call IDs).
 *
 * Rate-limit safety: 100ms sleep between page fetches → max 600/min,
 * well under the 60/min limit since we pace at 10/sec we'd hit limit. Actually
 * /min is per minute → 100ms = 600/min so we sleep 1100ms = ~54/min safe.
 */
export async function* iterAllCalls(
  opts: Omit<ListCallsOptions, "cursor">,
): AsyncIterableIterator<EightHundredCallV2> {
  let cursor: string | undefined
  while (true) {
    const page = await listCallsPage({ ...opts, cursor })
    for (const call of page.data) yield call
    if (!page.meta?.nextCursor) break
    cursor = page.meta.nextCursor
    // Pace to avoid 60-req/min rate limit
    await new Promise((r) => setTimeout(r, 1100))
  }
}

// ── Normalization ────────────────────────────────────────────────────────────

type CallsRow = Database["public"]["Tables"]["calls"]["Row"]
type CallDirection = Database["public"]["Enums"]["call_direction"]
type CallOutcome = Database["public"]["Enums"]["call_outcome"]

export type CrmCallRow = Omit<
  Database["public"]["Tables"]["calls"]["Insert"],
  "id" | "created_at"
>

type TrackingNumberRow = {
  id: string
  brand_id: string
  phone_e164: string
  provider_metadata: { number_id?: number; company_id?: number }
}

/**
 * Derive call_outcome from 800.com payload. Uses answeredBy + duration since
 * v2/calls doesn't include the per-call tags (those live on /calls/{id} detail).
 */
function deriveOutcome(call: EightHundredCallV2): CallOutcome | null {
  if (call.answeredBy && call.answeredBy.length > 0) return "connected"
  if (call.disconnectCause === "voicemail") return "voicemail"
  if ((call.duration ?? 0) === 0) return "no_answer"
  return null
}

/**
 * Transform a 800.com call into our CRM calls row shape. Pure function —
 * does NOT do matching/insertion. That's the importer's job.
 */
export function normalize800ToCrm(
  call: EightHundredCallV2,
  tracking: TrackingNumberRow,
  matchedLeadId: string | null,
  repIdFallback: string,
): CrmCallRow {
  const duration = call.duration ?? 0
  const direction: CallDirection = call.direction === "outbound" ? "outbound" : "inbound"
  const outcome = deriveOutcome(call)

  return {
    brand_id: tracking.brand_id,
    lead_id: matchedLeadId,
    rep_id: repIdFallback,
    direction,
    outcome,
    duration_seconds: duration > 0 ? duration : null,
    notes: null,
    source: "800com",
    external_id: String(call.id),
    recording_url: call.recordingUrl ?? null,
    transcript_text: null,
    ai_summary: null,
    ai_extracted: null,
    called_at: call.startedAt,
    caller_e164: call.caller,
    dialed_e164: call.dialed,
    tracking_number_id: tracking.id,
    transcription_status: call.recordingUrl ? "pending" : "skipped",
  } as CrmCallRow
}

// ── Persistence: matching + insert ───────────────────────────────────────────

export type ImportResult = {
  fetched: number
  inserted: number
  skipped_existing: number
  errors: { call_id: number; error: string }[]
  leads_matched: number
  leads_created: number
  duration_ms: number
}

/**
 * Find a lead by phone (E.164 match against leads.phone or leads.phone_alt).
 * Returns null if no match.
 */
async function findLeadByPhone(
  sb: DB,
  brandId: string,
  callerE164: string,
): Promise<string | null> {
  // Try exact match on phone first
  const { data: byPhone } = await sb
    .from("leads")
    .select("id")
    .eq("brand_id", brandId)
    .eq("phone", callerE164)
    .limit(1)
    .maybeSingle()
  if (byPhone?.id) return byPhone.id

  // Try phone_alt
  const { data: byAlt } = await sb
    .from("leads")
    .select("id")
    .eq("brand_id", brandId)
    .eq("phone_alt", callerE164)
    .limit(1)
    .maybeSingle()
  return byAlt?.id ?? null
}

/**
 * Create a new lead from an unknown caller. Status='new', source labeled with
 * provider + campaign so the rep can see where it came from.
 */
async function createLeadFromCall(
  sb: DB,
  brandId: string,
  callerE164: string,
  trackingLabel: string | null,
  campaign: string | null,
  firstName: string | null,
  lastName: string | null,
): Promise<string | null> {
  // Campaign info goes in notes (source enum is fixed list)
  const noteParts: string[] = ["Auto-creado desde llamada inbound (800.com)"]
  if (trackingLabel) noteParts.push(`Número: ${trackingLabel}`)
  if (campaign) noteParts.push(`Campaña: ${campaign}`)

  // Fallback al teléfono si 800.com no nos dio nombre todavía
  const effectiveFirst = firstName?.trim() || callerE164

  const { data, error } = await sb
    .from("leads")
    .insert({
      brand_id: brandId,
      first_name: effectiveFirst,
      last_name: lastName?.trim() || null,
      phone: callerE164,
      email: null,
      status: "new",
      source: "inbound_call",
      notes: noteParts.join(" · "),
    })
    .select("id")
    .single()
  if (error) {
    console.error("[800com] createLeadFromCall error:", error.message)
    return null
  }
  return data?.id ?? null
}

/**
 * Cache of tracking_numbers by provider_metadata.number_id, refreshed once
 * per import session.
 */
async function loadTrackingNumbersByNumberId(
  sb: DB,
): Promise<Map<number, TrackingNumberRow & { label: string | null; campaign: string | null }>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any)
    .from("tracking_numbers")
    .select("id, brand_id, phone_e164, label, campaign, provider_metadata")
    .eq("provider", "800com")
    .eq("active", true)
  if (error) throw new Error(`Failed loading tracking_numbers: ${error.message}`)

  const map = new Map<number, TrackingNumberRow & { label: string | null; campaign: string | null }>()
  for (const row of (data ?? []) as Array<TrackingNumberRow & { label: string | null; campaign: string | null }>) {
    const nid = row.provider_metadata?.number_id
    if (typeof nid === "number") map.set(nid, row)
  }
  return map
}

/**
 * Find a default rep_id to attribute calls to when we can't infer from
 * `answeredBy` (since that's a phone number, not a user_id). For now we
 * use the user that created the brand or any admin. Future: map
 * answeredBy phone → users.cell_phone.
 */
async function getFallbackRepId(sb: DB, brandId: string): Promise<string> {
  // Try: a user assigned to this brand with role 'rep' or 'manager'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ub } = await (sb as any)
    .from("user_brands")
    .select("user_id, users!inner(id, role, active)")
    .eq("brand_id", brandId)
    .eq("users.active", true)
    .limit(1)
    .maybeSingle()
  if (ub?.user_id) return ub.user_id as string

  // Last resort: any active admin
  const { data: admin } = await sb
    .from("users")
    .select("id")
    .eq("role", "admin")
    .eq("active", true)
    .limit(1)
    .maybeSingle()
  if (admin?.id) return admin.id

  throw new Error("No fallback rep_id available — at least 1 active user required")
}

export type ImportOptions = {
  /** ISO start date for the fetch window. Default: 24h ago for cron, longer for backfill. */
  startDate?: string
  /** ISO end date. Default: now. */
  endDate?: string
  /** If true, create leads for unknown callers. Default: true for backfill, true for cron. */
  autoCreateLeads?: boolean
  /** Max pages to fetch this run (protects against runaway). Default: 50 (= ~5000 calls). */
  maxPages?: number
}

export async function importCallsFromEightHundred(
  sb: DB,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const t0 = Date.now()
  const result: ImportResult = {
    fetched: 0,
    inserted: 0,
    skipped_existing: 0,
    errors: [],
    leads_matched: 0,
    leads_created: 0,
    duration_ms: 0,
  }

  const companyId = getCompanyId()
  const endDate = opts.endDate ?? new Date().toISOString()
  const startDate = opts.startDate ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const autoCreate = opts.autoCreateLeads ?? true
  const maxPages = opts.maxPages ?? 50

  // 1) Load tracking_numbers map (number_id → row)
  const trackingByNumberId = await loadTrackingNumbersByNumberId(sb)
  if (trackingByNumberId.size === 0) {
    console.warn("[800com] No tracking_numbers configured for provider=800com — nothing to do")
    return { ...result, duration_ms: Date.now() - t0 }
  }

  // 2) Cache rep fallback per brand
  const repIdByBrand = new Map<string, string>()

  // 3) Iterate calls page by page (cursor)
  let pagesProcessed = 0
  let cursor: string | undefined
  while (pagesProcessed < maxPages) {
    const page = await listCallsPage({ companyId, startDate, endDate, perPage: 100, cursor })
    pagesProcessed++

    for (const call of page.data) {
      result.fetched++

      // Only import calls to numbers we track
      const numberId = call.number?.id
      if (typeof numberId !== "number") continue
      const tracking = trackingByNumberId.get(numberId)
      if (!tracking) continue

      // Dedupe: already in DB?
      const { data: existing } = await sb
        .from("calls")
        .select("id")
        .eq("external_id", String(call.id))
        .eq("source", "800com")
        .limit(1)
        .maybeSingle()
      if (existing) {
        result.skipped_existing++
        continue
      }

      // Extract caller name de CNAM si 800.com lo trae
      const { firstName, lastName } = extractCallerName(call)

      // Lead matching by E.164 caller
      let leadId = await findLeadByPhone(sb, tracking.brand_id, call.caller)
      if (leadId) {
        result.leads_matched++
        // Si el lead existe pero su first_name es el propio teléfono (auto-creado
        // antes de tener CNAM), llenarlo con el nombre real si ahora sí lo tenemos.
        if (firstName) {
          const { data: existingLead } = await sb
            .from("leads")
            .select("first_name, last_name")
            .eq("id", leadId)
            .single()
          const looksLikePhone = existingLead?.first_name?.startsWith("+") || /^\d+$/.test(existingLead?.first_name ?? "")
          if (looksLikePhone) {
            await sb.from("leads").update({
              first_name: firstName,
              last_name: lastName ?? existingLead?.last_name ?? null,
            }).eq("id", leadId)
          }
        }
      } else if (autoCreate) {
        leadId = await createLeadFromCall(
          sb, tracking.brand_id, call.caller, tracking.label, tracking.campaign,
          firstName, lastName,
        )
        if (leadId) result.leads_created++
      }

      // Rep fallback (cached per brand)
      let repId = repIdByBrand.get(tracking.brand_id)
      if (!repId) {
        try {
          repId = await getFallbackRepId(sb, tracking.brand_id)
          repIdByBrand.set(tracking.brand_id, repId)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          result.errors.push({ call_id: call.id, error: `rep fallback: ${msg}` })
          continue
        }
      }

      // Normalize + insert
      const row = normalize800ToCrm(call, tracking, leadId, repId)
      const { error: insertErr } = await sb.from("calls").insert(row)
      if (insertErr) {
        result.errors.push({ call_id: call.id, error: insertErr.message })
      } else {
        result.inserted++
        // Bump lead last_contacted_at if matched
        if (leadId) {
          await sb
            .from("leads")
            .update({ last_contacted_at: call.startedAt })
            .eq("id", leadId)
        }
      }
    }

    if (!page.meta?.nextCursor) break
    cursor = page.meta.nextCursor
    // Rate-limit pacing (800.com: 60 req/min)
    await new Promise((r) => setTimeout(r, 1100))
  }

  result.duration_ms = Date.now() - t0
  return result
}
