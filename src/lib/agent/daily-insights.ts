/**
 * Daily Insights v1 — Stale Leads
 *
 * Detects leads not contacted in >= STALE_DAYS for each active rep/manager
 * and writes notifications (type='daily_summary' aggregate + 'stale_lead' per lead)
 * so the dashboard and notification bell surface them proactively.
 *
 * Sub-proyecto #5 del roadmap "Claude adentro del CRM".
 * Spec: docs/superpowers/specs/2026-05-19-daily-insights-stale-leads-design.md
 */

import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type DB = SupabaseClient<Database>

export const STALE_DAYS = 5
export const MAX_LEADS_PER_REP = 50
export const MAX_BELL_LEADS_PER_REP = 20

export type StaleLead = {
  id: string
  first_name: string
  last_name: string | null
  brand_id: string
  brand_name: string
  days_stale: number // 9999 if last_contacted_at is null (never contacted)
  last_contacted_at: string | null
}

export type Locale = "es" | "en"

// ── detectStaleLeads ────────────────────────────────────────────────────────

/**
 * Returns stale leads for a specific rep. Reuses the same filter as
 * fetchUrgentLeads (src/lib/queries/dashboard.ts:314-321) — leads not sold/lost,
 * last_contacted_at NULL or older than STALE_DAYS days, assigned to this rep.
 *
 * Joins brands.name for display. Capped at MAX_LEADS_PER_REP.
 */
export async function detectStaleLeads(
  sb: DB,
  repId: string,
  threshold: number = STALE_DAYS,
  brandId: string | null = null,
): Promise<StaleLead[]> {
  const staleThreshold = new Date(Date.now() - threshold * 86_400_000).toISOString()

  let q = sb
    .from("leads")
    .select("id, first_name, last_name, brand_id, last_contacted_at, brands!inner(name)")
    .eq("assigned_rep_id", repId)
    .not("status", "in", "(sold,lost)")
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${staleThreshold}`)
    .order("last_contacted_at", { ascending: true, nullsFirst: true })
    .limit(MAX_LEADS_PER_REP)
  if (brandId) q = q.eq("brand_id", brandId)

  const { data, error } = await q

  if (error) {
    console.error("[daily-insights] detectStaleLeads error:", error.message)
    return []
  }

  const now = Date.now()
  return ((data ?? []) as unknown as Array<{
    id: string
    first_name: string
    last_name: string | null
    brand_id: string
    last_contacted_at: string | null
    brands: { name: string } | { name: string }[] | null
  }>).map((r) => {
    const brand = Array.isArray(r.brands) ? r.brands[0] : r.brands
    return {
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      brand_id: r.brand_id,
      brand_name: brand?.name ?? "—",
      last_contacted_at: r.last_contacted_at,
      days_stale: r.last_contacted_at
        ? Math.floor((now - new Date(r.last_contacted_at).getTime()) / 86_400_000)
        : 9999,
    }
  })
}

// ── buildSummaryTemplate ─────────────────────────────────────────────────────

/**
 * Deterministic template. Bilingual. No LLM. Returns plain text suitable
 * for notifications.body. Used by the cron default and as fallback when
 * Claude regenerate fails.
 */
export function buildSummaryTemplate(
  staleLeads: StaleLead[],
  locale: Locale,
  repFirstName: string,
): { subject: string; body: string } {
  const count = staleLeads.length
  const fullName = (l: StaleLead) =>
    l.last_name ? `${l.first_name} ${l.last_name}` : l.first_name

  if (count === 0) {
    if (locale === "en") {
      return {
        subject: "You're all caught up",
        body: `Hi ${repFirstName}. You're all caught up — no stale leads.`,
      }
    }
    return {
      subject: "Estás al día",
      body: `Hola ${repFirstName}. Estás al día — no tenés leads sin contactar.`,
    }
  }

  // Cap list at 5 names; if more, "y N más"
  const listNames = staleLeads.slice(0, 5).map(fullName).join(", ")
  const extra =
    count > 5 ? (locale === "en" ? ` and ${count - 5} more` : ` y ${count - 5} más`) : ""
  const listText = listNames + extra

  if (locale === "en") {
    return {
      subject: `${count} stale lead${count !== 1 ? "s" : ""}`,
      body: `Hi ${repFirstName}. You have ${count} lead${count !== 1 ? "s" : ""} not contacted in over ${STALE_DAYS} days: ${listText}. Follow up today.`,
    }
  }
  return {
    subject: `${count} lead${count !== 1 ? "s" : ""} sin contactar`,
    body: `Hola ${repFirstName}. Tenés ${count} lead${count !== 1 ? "s" : ""} sin contactar hace más de ${STALE_DAYS} días: ${listText}. Hacé follow-up hoy.`,
  }
}

// ── generateForRep ───────────────────────────────────────────────────────────

type ActiveRep = {
  id: string
  name: string
  role: string
}

export type GenerateForRepResult = {
  user_id: string
  stale_count: number
  summary_id: string | null
  error: string | null
}

/**
 * Idempotent: DELETE today's daily_summary + stale_lead notifications for this
 * user, then INSERT fresh. If the cron runs twice the result equals the last run.
 */
export async function generateForRep(
  sb: DB,
  rep: ActiveRep,
  locale: Locale = "es",
): Promise<GenerateForRepResult> {
  try {
    const staleLeads = await detectStaleLeads(sb, rep.id)
    const firstName = rep.name.split(/\s+/)[0] || rep.name
    const template = buildSummaryTemplate(staleLeads, locale, firstName)

    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const todayEnd = new Date(todayStart.getTime() + 86_400_000)

    // 1) DELETE today's previous runs for idempotency
    const { error: delErr } = await sb
      .from("notifications")
      .delete()
      .eq("user_id", rep.id)
      .in("type", ["daily_summary", "stale_lead"])
      .gte("created_at", todayStart.toISOString())
      .lt("created_at", todayEnd.toISOString())

    if (delErr) throw new Error(`DELETE failed: ${delErr.message}`)

    // 2) INSERT daily_summary (always — even if 0 leads, "you're all caught up")
    const { data: summaryRow, error: summaryErr } = await sb
      .from("notifications")
      .insert({
        user_id: rep.id,
        channel: "in_app",
        type: "daily_summary",
        subject: template.subject,
        body: template.body,
        sent_at: new Date().toISOString(),
      })
      .select("id")
      .single()

    if (summaryErr || !summaryRow) throw new Error(`summary INSERT failed: ${summaryErr?.message}`)

    // 3) INSERT 1 stale_lead notification per lead (cap MAX_BELL_LEADS_PER_REP)
    if (staleLeads.length > 0) {
      const fullName = (l: StaleLead) =>
        l.last_name ? `${l.first_name} ${l.last_name}` : l.first_name
      const daysText = (d: number) =>
        d >= 9999 ? "nunca contactado" : `hace ${d} día${d !== 1 ? "s" : ""}`

      const rows = staleLeads.slice(0, MAX_BELL_LEADS_PER_REP).map((l) => ({
        user_id: rep.id,
        channel: "in_app",
        type: "stale_lead",
        subject: fullName(l),
        body: `${fullName(l)} — ${daysText(l.days_stale)} (${l.brand_name})`,
        related_lead_id: l.id,
        sent_at: new Date().toISOString(),
      }))

      const { error: leadsErr } = await sb.from("notifications").insert(rows)
      if (leadsErr) throw new Error(`stale_lead INSERT failed: ${leadsErr.message}`)
    }

    return {
      user_id: rep.id,
      stale_count: staleLeads.length,
      summary_id: summaryRow.id,
      error: null,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[daily-insights] generateForRep failed for ${rep.id}:`, msg)
    return { user_id: rep.id, stale_count: 0, summary_id: null, error: msg }
  }
}

// ── generateDailyInsightsForAllReps ─────────────────────────────────────────

export type GenerateAllResult = {
  users_processed: number
  total_insights: number
  errors: { user_id: string; error: string }[]
  duration_ms: number
}

/**
 * Iterates active users with role IN ('rep','manager'), processes each.
 * Admins are NOT included by default (typically don't own leads directly).
 * Continues on error per-user — one rep's failure doesn't abort the cron.
 */
export async function generateDailyInsightsForAllReps(
  sb: DB,
): Promise<GenerateAllResult> {
  const t0 = Date.now()
  const errors: { user_id: string; error: string }[] = []
  let totalInsights = 0

  const { data: users, error: usersErr } = await sb
    .from("users")
    .select("id, name, role")
    .eq("active", true)
    .in("role", ["rep", "manager"])

  if (usersErr) {
    console.error("[daily-insights] failed to list users:", usersErr.message)
    return {
      users_processed: 0,
      total_insights: 0,
      errors: [{ user_id: "list_users", error: usersErr.message }],
      duration_ms: Date.now() - t0,
    }
  }

  const usersList = (users ?? []) as ActiveRep[]

  for (const u of usersList) {
    const res = await generateForRep(sb, u, "es")
    if (res.error) {
      errors.push({ user_id: u.id, error: res.error })
    } else {
      totalInsights += res.stale_count
    }
  }

  return {
    users_processed: usersList.length,
    total_insights: totalInsights,
    errors,
    duration_ms: Date.now() - t0,
  }
}

// ── buildSummaryWithClaude (on-demand) ──────────────────────────────────────

/**
 * On-demand: llamada explícita desde el botón Regenerar del AgentSummaryCard.
 * El cron diario usa buildSummaryTemplate (determinístico, sin costo). Esta
 * función es opt-in del rep cuando quiere algo más personalizado.
 *
 * Modelo: Sonnet 4.6 (mismo que /api/agent/ask). Costo: ~$0.001 por llamada.
 * Si falla (timeout, rate limit, sin API key) el caller debe usar el template.
 */
export async function buildSummaryWithClaude(
  staleLeads: StaleLead[],
  repFirstName: string,
  locale: Locale = "es",
): Promise<{ subject: string; body: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const leadsContext = staleLeads
    .slice(0, 10)
    .map((l) => {
      const name = l.last_name ? `${l.first_name} ${l.last_name}` : l.first_name
      const days = l.days_stale >= 9999 ? "nunca contactado" : `${l.days_stale} días`
      return `- ${name} (${l.brand_name}) — ${days}`
    })
    .join("\n")

  const langInstr =
    locale === "en"
      ? "Respond in English."
      : "Responde en español, tono natural y cálido."

  const prompt =
    locale === "en"
      ? `You are the CRM assistant for ${repFirstName}. They have ${staleLeads.length} leads not contacted in over ${STALE_DAYS} days:\n\n${leadsContext}\n\nWrite ONE short paragraph (2-3 sentences) addressed to ${repFirstName}, mentioning the most overdue 2-3 leads by name and suggesting today's priority. Conversational, not robotic. ${langInstr}`
      : `Sos el asistente del CRM de ${repFirstName}. Tiene ${staleLeads.length} leads sin contactar hace más de ${STALE_DAYS} días:\n\n${leadsContext}\n\nEscribí UN párrafo corto (2-3 oraciones) dirigido a ${repFirstName}, mencionando los 2-3 más atrasados por nombre y sugiriendo a quién contactar hoy. Conversacional, no robótico. ${langInstr}`

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  })

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("")
    .trim()

  // Subject = primera frase truncada a 60 chars
  const firstSentence = text.split(/[.!?]/)[0]?.trim() ?? text.slice(0, 60)
  const subject =
    firstSentence.length > 60 ? firstSentence.slice(0, 57) + "..." : firstSentence

  return { subject, body: text }
}
