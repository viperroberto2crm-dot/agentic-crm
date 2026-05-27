/**
 * Meta Lead Ads Integration — polls Facebook/Instagram Lead Forms via Graph API
 * and creates `leads` rows in the CRM scoped to the appropriate brand.
 *
 * Architecture (2026-05-22):
 *   - Auth: Page Access Token (permanent, derived from a long-lived User token).
 *     Required scopes: leads_retrieval, pages_show_list, pages_read_engagement,
 *     pages_manage_ads.
 *   - Catalog: `tracking_forms` table holds the [provider='meta',
 *     external_form_id] rows we poll. `provider_metadata.questions` maps
 *     Meta's custom keys ("0","1",...) to friendly `crm_field` names that
 *     end up in `leads.custom_fields`.
 *   - Dedup: 3 layers per lead —
 *       1) by external_id + external_provider='meta' (idempotent re-runs)
 *       2) by email within brand (MERGE into existing lead)
 *       3) by phone within brand (MERGE into existing lead)
 *       4) otherwise CREATE new lead
 *   - Backfill: default lookback = 90 days (Meta's max retention).
 *
 * Token renewal note: Meta's "Data Access" expires every ~90 days (security
 * policy separate from token Expires:Never). When this happens the Graph API
 * returns OAuthException with "data access expired" — the operator must
 * regenerate the Page Access Token via Graph API Explorer.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type DB = SupabaseClient<Database>

const GRAPH_API_VERSION = "v25.0"
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

// ── Types ────────────────────────────────────────────────────────────────────

export type MetaFieldData = {
  /** 'FULL_NAME' | 'EMAIL' | 'PHONE' | '0' | '1' | ... (custom keys are numeric strings) */
  name: string
  values: string[]
}

export type MetaLeadV1 = {
  /** Meta lead ID, globally unique and stable forever */
  id: string
  /** ISO 8601 timestamp when the user submitted the form */
  created_time: string
  ad_id?: string
  adset_id?: string
  campaign_id?: string
  form_id?: string
  field_data: MetaFieldData[]
}

type MetaLeadsResponse = {
  data: MetaLeadV1[]
  paging?: {
    cursors?: { before?: string; after?: string }
    next?: string
  }
}

export type TrackingFormRow = {
  id: string
  brand_id: string
  provider: string
  external_form_id: string
  external_page_id: string | null
  name: string
  campaign: string | null
  active: boolean
  provider_metadata: {
    questions?: Array<{ key: string; label: string; crm_field: string }>
  }
}

// ── Low-level client ─────────────────────────────────────────────────────────

function getPageAccessToken(): string {
  const t = process.env.META_PAGE_ACCESS_TOKEN
  if (!t) throw new Error("META_PAGE_ACCESS_TOKEN not configured")
  return t
}

async function fetchLeadsPage(opts: {
  formId: string
  token: string
  after?: string
  limit?: number
  sinceTimestamp?: number
}): Promise<MetaLeadsResponse> {
  const params = new URLSearchParams()
  params.set("access_token", opts.token)
  params.set(
    "fields",
    "id,created_time,ad_id,adset_id,campaign_id,form_id,field_data",
  )
  params.set("limit", String(opts.limit ?? 100))
  if (opts.after) params.set("after", opts.after)
  if (opts.sinceTimestamp) {
    params.set(
      "filtering",
      JSON.stringify([
        {
          field: "time_created",
          operator: "GREATER_THAN",
          value: opts.sinceTimestamp,
        },
      ]),
    )
  }

  const url = `${GRAPH_API_BASE}/${opts.formId}/leads?${params.toString()}`
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Meta /leads ${res.status}: ${body.slice(0, 400)}`)
  }
  return (await res.json()) as MetaLeadsResponse
}

/**
 * Iterate ALL leads for a form using cursor pagination. Caller controls
 * termination (e.g. break after seeing already-imported IDs).
 *
 * Rate-limit pacing: 250ms between pages = max 240 req/min. Meta's standard
 * Marketing API tier allows ~200/hour per app — we're well under.
 */
export async function* iterAllLeads(
  formId: string,
  opts: { sinceTimestamp?: number } = {},
): AsyncIterableIterator<MetaLeadV1> {
  const token = getPageAccessToken()
  let after: string | undefined
  while (true) {
    const page = await fetchLeadsPage({
      formId,
      token,
      after,
      sinceTimestamp: opts.sinceTimestamp,
    })
    for (const lead of page.data) yield lead
    if (!page.paging?.cursors?.after || page.data.length === 0) break
    after = page.paging.cursors.after
    await new Promise((r) => setTimeout(r, 250))
  }
}

/**
 * Fetch the form structure (questions, name) for a given form_id.
 * Used by syncFormStructure to refresh tracking_forms metadata.
 */
export type MetaFormQuestion = {
  key: string
  label: string
  type: string
}
export type MetaForm = {
  id: string
  name: string
  status?: string
  locale?: string
  questions: MetaFormQuestion[]
}

export async function fetchFormStructure(formId: string): Promise<MetaForm> {
  const token = getPageAccessToken()
  const params = new URLSearchParams()
  params.set("access_token", token)
  params.set("fields", "id,name,status,locale,questions{key,label,type}")
  const url = `${GRAPH_API_BASE}/${formId}?${params.toString()}`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Meta /form ${res.status}: ${body.slice(0, 300)}`)
  }
  return (await res.json()) as MetaForm
}

/**
 * Slugify a label into a stable lower_snake_case key for custom_fields.
 * Keeps it short (40 chars) and removes accents/non-alphanumerics.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "custom"
}

/** Standard Meta field keys that map directly to leads columns, not custom_fields. */
const STANDARD_KEYS = new Set([
  "FULL_NAME",
  "FIRST_NAME",
  "LAST_NAME",
  "EMAIL",
  "PHONE",
  "PHONE_NUMBER",
])

/**
 * Refresh tracking_forms.provider_metadata.questions from Meta. Preserves
 * existing crm_field mappings for known keys; auto-generates crm_field
 * (slugified label) for new keys. Standard keys (FULL_NAME, EMAIL, PHONE)
 * are skipped since they map to leads columns directly.
 *
 * Non-fatal: if the fetch fails, returns the original form unchanged and logs.
 */
async function syncFormStructure(
  sb: DB,
  form: TrackingFormRow,
): Promise<TrackingFormRow> {
  let metaForm: MetaForm
  try {
    metaForm = await fetchFormStructure(form.external_form_id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(
      `[meta-lead-ads] syncFormStructure failed for ${form.external_form_id}: ${msg}`,
    )
    return form
  }

  const existingByKey = new Map(
    (form.provider_metadata?.questions ?? []).map((q) => [q.key, q]),
  )
  const newQuestions: Array<{ key: string; label: string; crm_field: string }> = []
  for (const q of metaForm.questions ?? []) {
    if (STANDARD_KEYS.has(q.key.toUpperCase())) continue
    const existing = existingByKey.get(q.key)
    const crm_field = existing?.crm_field ?? slugify(q.label)
    newQuestions.push({ key: q.key, label: q.label, crm_field })
  }

  // Diff check — avoid useless UPDATEs
  const newJson = JSON.stringify(newQuestions)
  const oldJson = JSON.stringify(form.provider_metadata?.questions ?? [])
  const nameChanged = (metaForm.name?.trim() || "") !== form.name
  if (newJson === oldJson && !nameChanged) return form

  const newMetadata = { ...form.provider_metadata, questions: newQuestions }
  const newName = metaForm.name?.trim() || form.name

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any)
    .from("tracking_forms")
    .update({ provider_metadata: newMetadata, name: newName })
    .eq("id", form.id)
  if (error) {
    console.warn(
      `[meta-lead-ads] failed to persist synced form ${form.external_form_id}: ${error.message}`,
    )
    return form
  }

  console.log(
    `[meta-lead-ads] synced form ${form.external_form_id}: ${newQuestions.length} custom questions`,
  )
  return { ...form, provider_metadata: newMetadata, name: newName }
}

// ── Normalization ────────────────────────────────────────────────────────────

export function splitFullName(fullName: string): {
  firstName: string
  lastName: string | null
} {
  const trimmed = fullName.trim()
  if (!trimmed) return { firstName: "", lastName: null }
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: null }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") }
}

export type DecodedLead = {
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  customFields: Record<string, string>
}

/**
 * Decode `field_data` into standard CRM fields + custom_fields blob.
 * Standard keys (FULL_NAME, EMAIL, PHONE) are recognized verbatim.
 * Custom keys ("0","1",...) are mapped via the form's `questionMap`
 * (built from tracking_forms.provider_metadata.questions).
 */
export function decodeFieldData(
  fieldData: MetaFieldData[],
  questionMap: Map<string, { label: string; crm_field: string }>,
): DecodedLead {
  const r: DecodedLead = {
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    customFields: {},
  }

  for (const fd of fieldData) {
    const value = fd.values?.[0] ?? null
    if (!value) continue

    const key = fd.name.toUpperCase()
    if (key === "FULL_NAME") {
      const { firstName, lastName } = splitFullName(value)
      r.firstName = firstName
      r.lastName = lastName
    } else if (key === "FIRST_NAME") {
      r.firstName = value.trim()
    } else if (key === "LAST_NAME") {
      r.lastName = value.trim()
    } else if (key === "EMAIL") {
      r.email = value.trim().toLowerCase() || null
    } else if (key === "PHONE" || key === "PHONE_NUMBER") {
      r.phone = value.trim() || null
    } else {
      const mapping = questionMap.get(fd.name)
      const crmKey = mapping?.crm_field ?? `custom_${fd.name}`
      r.customFields[crmKey] = value
    }
  }
  return r
}

// ── Persistence: dedup + insert/merge ────────────────────────────────────────

async function findLeadByMetaId(sb: DB, metaLeadId: string): Promise<string | null> {
  // leads.external_id / external_provider columns may not be in database.ts
  // yet → use 'as any' cast (same pattern 800com.ts uses for tracking_numbers).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from("leads")
    .select("id")
    .eq("external_provider", "meta")
    .eq("external_id", metaLeadId)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

async function findLeadByEmail(
  sb: DB,
  brandId: string,
  email: string,
): Promise<string | null> {
  const { data } = await sb
    .from("leads")
    .select("id")
    .eq("brand_id", brandId)
    .ilike("email", email)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

async function findLeadByPhone(
  sb: DB,
  brandId: string,
  phone: string,
): Promise<string | null> {
  const { data: byPhone } = await sb
    .from("leads")
    .select("id")
    .eq("brand_id", brandId)
    .eq("phone", phone)
    .limit(1)
    .maybeSingle()
  if (byPhone?.id) return byPhone.id

  const { data: byAlt } = await sb
    .from("leads")
    .select("id")
    .eq("brand_id", brandId)
    .eq("phone_alt", phone)
    .limit(1)
    .maybeSingle()
  return byAlt?.id ?? null
}

/**
 * Load all active tracking_forms for provider='meta'.
 * Uses 'as any' cast since tracking_forms is not in database.ts (same pattern
 * as tracking_numbers in 800com.ts).
 */
async function loadActiveMetaForms(sb: DB): Promise<TrackingFormRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any)
    .from("tracking_forms")
    .select(
      "id, brand_id, provider, external_form_id, external_page_id, name, campaign, active, provider_metadata",
    )
    .eq("provider", "meta")
    .eq("active", true)
  if (error) throw new Error(`Failed loading tracking_forms: ${error.message}`)
  return (data ?? []) as TrackingFormRow[]
}

export type ImportResult = {
  forms_processed: number
  fetched: number
  inserted: number
  updated: number
  skipped_existing: number
  errors: { lead_id: string; error: string }[]
  duration_ms: number
}

export type ImportOptions = {
  /** Unix timestamp (seconds). Default: 90 days ago (Meta's max retention). */
  sinceTimestamp?: number
  /** Max leads to process per form per run. Default: 1000 (runaway guard). */
  maxLeadsPerForm?: number
}

export async function importMetaLeadsToCrm(
  sb: DB,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const t0 = Date.now()
  const result: ImportResult = {
    forms_processed: 0,
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped_existing: 0,
    errors: [],
    duration_ms: 0,
  }

  const sinceTimestamp =
    opts.sinceTimestamp ??
    Math.floor((Date.now() - 90 * 24 * 3600 * 1000) / 1000)
  const maxLeadsPerForm = opts.maxLeadsPerForm ?? 1000

  const forms = await loadActiveMetaForms(sb)
  if (forms.length === 0) {
    console.warn(
      "[meta-lead-ads] No active tracking_forms configured for provider=meta",
    )
    return { ...result, duration_ms: Date.now() - t0 }
  }

  for (const formRow of forms) {
    result.forms_processed++

    // Refresh form structure from Meta (auto-sync new/renamed questions)
    const form = await syncFormStructure(sb, formRow)

    const questionMap = new Map<string, { label: string; crm_field: string }>()
    for (const q of form.provider_metadata?.questions ?? []) {
      questionMap.set(q.key, { label: q.label, crm_field: q.crm_field })
    }

    let processed = 0
    try {
      for await (const lead of iterAllLeads(form.external_form_id, {
        sinceTimestamp,
      })) {
        if (processed >= maxLeadsPerForm) {
          console.warn(
            `[meta-lead-ads] maxLeadsPerForm=${maxLeadsPerForm} hit for ${form.external_form_id}`,
          )
          break
        }
        processed++
        result.fetched++

        try {
          // Layer 1: skip if already imported (idempotent)
          if (await findLeadByMetaId(sb, lead.id)) {
            result.skipped_existing++
            continue
          }

          const decoded = decodeFieldData(lead.field_data, questionMap)

          const customFields: Record<string, unknown> = {
            ...decoded.customFields,
            meta_lead_id: lead.id,
            meta_form_id: form.external_form_id,
            meta_form_name: form.name,
            meta_created_time: lead.created_time,
            ...(lead.ad_id ? { meta_ad_id: lead.ad_id } : {}),
            ...(lead.adset_id ? { meta_adset_id: lead.adset_id } : {}),
            ...(lead.campaign_id ? { meta_campaign_id: lead.campaign_id } : {}),
          }

          // Layers 2-3: try to MERGE with existing CRM lead (by email then phone)
          let existingId: string | null = null
          if (decoded.email) {
            existingId = await findLeadByEmail(sb, form.brand_id, decoded.email)
          }
          if (!existingId && decoded.phone) {
            existingId = await findLeadByPhone(sb, form.brand_id, decoded.phone)
          }

          // Build Q&A block from the form's question map (only includes
          // fields that the form actually defines, in declaration order).
          const qaLines: string[] = []
          for (const q of form.provider_metadata?.questions ?? []) {
            const value = decoded.customFields[q.crm_field]
            if (value) qaLines.push(`• ${q.label}: ${value}`)
          }
          const qaBlock =
            qaLines.length > 0
              ? `\n\n📋 Respuestas del formulario:\n${qaLines.join("\n")}`
              : ""

          if (existingId) {
            // MERGE: keep existing first_name/last_name/email/phone untouched;
            // append Meta data to custom_fields + add note.
            const { data: existingLead } = await sb
              .from("leads")
              .select("custom_fields, notes")
              .eq("id", existingId)
              .single()

            const mergedCustom = {
              ...((existingLead?.custom_fields as Record<string, unknown> | null) ??
                {}),
              ...customFields,
            }

            const noteDate = lead.created_time.slice(0, 10)
            const newSubmission = `[${noteDate}] Nuevo submission Facebook Lead Form (${form.name})${qaBlock}`
            const mergedNotes = [existingLead?.notes ?? "", newSubmission]
              .filter(Boolean)
              .join("\n\n")

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: updErr } = await (sb as any)
              .from("leads")
              .update({
                external_id: lead.id,
                external_provider: "meta",
                custom_fields: mergedCustom,
                notes: mergedNotes,
                last_contacted_at: lead.created_time,
              })
              .eq("id", existingId)

            if (updErr) {
              result.errors.push({
                lead_id: lead.id,
                error: `merge: ${updErr.message}`,
              })
            } else {
              result.updated++
            }
          } else {
            // Layer 4: CREATE new lead (pool — no assigned_rep_id)
            const firstName = decoded.firstName?.trim() || "(Sin nombre)"
            const createdDate = lead.created_time.slice(0, 10)
            const notes = `Lead capturado desde ${form.name} (Facebook/Instagram Lead Ads · ${createdDate})${qaBlock}`
            // NOTA: NO llamar maybeEnrichLead aquí. Meta Lead Ads ya trae
            // first_name/last_name/email/phone del form, así que el enrich
            // tendría poco valor adicional. Y al ser un cron batch que puede
            // procesar muchos leads de golpe, las llamadas síncronas a ECID
            // saturarían el rate limit (60/min) de 800.com. Si se necesita
            // enriquecer dirección, usar /admin/ecid-backfill manualmente.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: insErr } = await (sb as any).from("leads").insert({
              brand_id: form.brand_id,
              first_name: firstName,
              last_name: decoded.lastName,
              email: decoded.email,
              phone: decoded.phone,
              status: "new",
              source: "facebook",
              external_id: lead.id,
              external_provider: "meta",
              notes,
              custom_fields: customFields,
              last_contacted_at: lead.created_time,
            })

            if (insErr) {
              result.errors.push({ lead_id: lead.id, error: insErr.message })
            } else {
              result.inserted++
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          result.errors.push({ lead_id: lead.id, error: msg })
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push({
        lead_id: `form:${form.external_form_id}`,
        error: msg,
      })
    }
  }

  result.duration_ms = Date.now() - t0
  return result
}
