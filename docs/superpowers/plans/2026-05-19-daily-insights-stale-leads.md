# Daily Insights v1 — Stale Leads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a proactive "Daily Insights" system that detects stale leads (≥5 days without contact) per rep via a 7:30 UTC cron, then surfaces them in 3 places: the `AgentSummaryCard` (existing), the notification bell (existing), and a new collapsible panel in the dashboard.

**Architecture:** Vercel cron hits `/api/agent/daily-insights` daily → service-role iterates active reps/managers → for each rep `detectStaleLeads()` queries `leads` (reusing `fetchUrgentLeads`'s stale logic) → DELETE+INSERT into `notifications` table (idempotent) with `type='daily_summary'` (1 row) + `type='stale_lead'` (N rows). Dashboard reads the existing slots; new `DailyInsightsPanel` component reads stale leads directly for inline CTAs. Optional `regenerateAgentSummary` server action calls Claude on-demand to swap the template body with personalized text.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (Postgres + RLS + service role), `@anthropic-ai/sdk`, `next-intl`, Tailwind + shadcn/ui, Vercel Cron Jobs.

**Spec:** `docs/superpowers/specs/2026-05-19-daily-insights-stale-leads-design.md` (commit `4ba3700`)

**Project note:** The repo has no automated test framework (no jest/vitest). Validation is via `npm run typecheck`, manual smoke tests with `curl`, and SQL inspection via the Supabase MCP. Plan steps use those instead of unit tests.

---

## Task 0: Setup `CRON_SECRET` env var in Vercel

**Goal:** Set the secret that Vercel injects as `Authorization: Bearer ${CRON_SECRET}` when calling cron endpoints. Without it the cron route returns 401.

**This is a manual step the user performs in the Vercel dashboard.** The implementing agent must pause and confirm with the user before proceeding to Task 5 (cron endpoint) because Task 5 reads this env var.

**Files:** None.

- [ ] **Step 0.1: Generate a secret locally**

Run:
```bash
openssl rand -hex 32
```
Expected output: 64-char hex string. Copy it.

- [ ] **Step 0.2: Add to Vercel project**

Manual steps for user (paste this to the user verbatim):

> 1. Open https://vercel.com/horizon-s-projects/proyectosagentic-crm/settings/environment-variables
> 2. Click "Add New"
> 3. Key: `CRON_SECRET`
> 4. Value: paste the hex string from step 0.1
> 5. Environments: check **Production** and **Preview** (uncheck Development if you want)
> 6. Save

- [ ] **Step 0.3: Confirm with user**

Ask user: "¿Listo? ¿Agregaste `CRON_SECRET` a Vercel?" Wait for confirmation before proceeding to Task 5.

**Commit:** None (no code changes).

---

## Task 1: Create `daily-insights.ts` — types and `detectStaleLeads`

**Goal:** Core data layer. Pure function that queries `leads` for a given rep and returns enriched stale lead rows.

**Files:**
- Create: `src/lib/agent/daily-insights.ts`

- [ ] **Step 1.1: Create the file with types and `detectStaleLeads`**

Write `src/lib/agent/daily-insights.ts`:

```typescript
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
  days_stale: number  // 9999 if last_contacted_at is null (never contacted)
  last_contacted_at: string | null
}

export type Locale = "es" | "en"

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
): Promise<StaleLead[]> {
  const staleThreshold = new Date(Date.now() - threshold * 86_400_000).toISOString()

  const { data, error } = await sb
    .from("leads")
    .select("id, first_name, last_name, brand_id, last_contacted_at, brands:brand_id(name)")
    .eq("assigned_rep_id", repId)
    .not("status", "in", "(sold,lost)")
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${staleThreshold}`)
    .order("last_contacted_at", { ascending: true, nullsFirst: true })
    .limit(MAX_LEADS_PER_REP)

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
    brands: { name: string } | null
  }>).map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    brand_id: r.brand_id,
    brand_name: r.brands?.name ?? "—",
    last_contacted_at: r.last_contacted_at,
    days_stale: r.last_contacted_at
      ? Math.floor((now - new Date(r.last_contacted_at).getTime()) / 86_400_000)
      : 9999,
  }))
}
```

- [ ] **Step 1.2: Run typecheck**

```bash
cd /c/Users/thead/proyectosagentic-crm && npx tsc --noEmit
```
Expected: no errors. If errors appear about the `brands:brand_id(name)` nested select, the codebase uses a slightly different syntax — adjust by looking at `src/lib/queries/dashboard.ts:262-263` for the brands-join pattern (`brands!inner(slug, name)`) and replicate.

- [ ] **Step 1.3: Commit**

```bash
cd /c/Users/thead/proyectosagentic-crm && git add src/lib/agent/daily-insights.ts && git commit -m "feat(daily-insights): detectStaleLeads + types"
```

---

## Task 2: Add `buildSummaryTemplate` to `daily-insights.ts`

**Goal:** Deterministic Spanish/English template that turns a list of stale leads into `{subject, body}`. Used by the cron and as fallback when Claude regenerate fails.

**Files:**
- Modify: `src/lib/agent/daily-insights.ts` (append at end)

- [ ] **Step 2.1: Append `buildSummaryTemplate`**

Add to the bottom of `src/lib/agent/daily-insights.ts`:

```typescript
/**
 * Deterministic template. Bilingual. No LLM. Returns plain text suitable
 * for notifications.body. Used by the cron default and as fallback when
 * Claude regenerate fails.
 *
 * Examples:
 *   buildSummaryTemplate([], "es", "Honorina") →
 *     { subject: "Estás al día", body: "Hola Honorina. Estás al día — no tenés leads sin contactar." }
 *
 *   buildSummaryTemplate([3 leads], "es", "Moe") →
 *     { subject: "3 leads sin contactar", body: "Hola Moe. Tenés 3 leads sin contactar hace más de 5 días: María Pulido, Roberto Castro, Edna C. Hacé follow-up hoy." }
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
  const extra = count > 5 ? (locale === "en" ? ` and ${count - 5} more` : ` y ${count - 5} más`) : ""
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
```

- [ ] **Step 2.2: Typecheck**

```bash
cd /c/Users/thead/proyectosagentic-crm && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 2.3: Commit**

```bash
cd /c/Users/thead/proyectosagentic-crm && git add src/lib/agent/daily-insights.ts && git commit -m "feat(daily-insights): buildSummaryTemplate (bilingual, deterministic)"
```

---

## Task 3: Add `generateForRep` and `generateDailyInsightsForAllReps` (orchestrators with idempotency)

**Goal:** The orchestrator: for one rep, detect stale leads, then DELETE+INSERT today's notifications. For all reps, iterate.

**Files:**
- Modify: `src/lib/agent/daily-insights.ts` (append)

- [ ] **Step 3.1: Append `generateForRep`**

```typescript
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
      const daysText = (d: number) => (d >= 9999 ? "nunca contactado" : `hace ${d} día${d !== 1 ? "s" : ""}`)

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
```

- [ ] **Step 3.2: Append `generateDailyInsightsForAllReps`**

```typescript
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
    return { users_processed: 0, total_insights: 0, errors: [{ user_id: "list_users", error: usersErr.message }], duration_ms: Date.now() - t0 }
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
```

- [ ] **Step 3.3: Typecheck**

```bash
cd /c/Users/thead/proyectosagentic-crm && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3.4: Commit**

```bash
cd /c/Users/thead/proyectosagentic-crm && git add src/lib/agent/daily-insights.ts && git commit -m "feat(daily-insights): generateForRep + generateDailyInsightsForAllReps (idempotent)"
```

---

## Task 4: Create cron endpoint `/api/agent/daily-insights/route.ts`

**Goal:** HTTP entry point that Vercel cron hits at 7:30 UTC. Validates `CRON_SECRET` header, calls `generateDailyInsightsForAllReps`, returns JSON stats.

**Files:**
- Create: `src/app/api/agent/daily-insights/route.ts`

- [ ] **Step 4.1: Write the endpoint**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { generateDailyInsightsForAllReps } from "@/lib/agent/daily-insights"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  // Vercel injects Authorization: Bearer ${CRON_SECRET} on declared crons.
  // Manual triggers (curl) must supply it too.
  const authHeader = req.headers.get("authorization") ?? ""
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server" },
      { status: 500 },
    )
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Service role: needs to iterate all users + write to notifications for any user.
  const sb = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await generateDailyInsightsForAllReps(sb as any)

  return NextResponse.json({
    ok: result.errors.length === 0,
    ...result,
  })
}
```

- [ ] **Step 4.2: Typecheck**

```bash
cd /c/Users/thead/proyectosagentic-crm && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
cd /c/Users/thead/proyectosagentic-crm && git add src/app/api/agent/daily-insights/route.ts && git commit -m "feat(daily-insights): cron endpoint with CRON_SECRET auth"
```

---

## Task 5: Register cron in `vercel.json`

**Goal:** Vercel cron schedules the endpoint to run daily at 7:30 UTC (30 min after the existing reflect cron).

**Files:**
- Modify: `vercel.json`

- [ ] **Step 5.1: Read current `vercel.json`**

Run:
```bash
cd /c/Users/thead/proyectosagentic-crm && cat vercel.json
```
Expected: existing JSON with a `crons` array containing 1 entry for `/api/agent/reflect`. Note the exact JSON structure to preserve formatting.

- [ ] **Step 5.2: Add the new cron entry**

Use Edit to add a second entry to the `crons` array. The expected final shape (do NOT replace any existing entry — append):

```json
{
  "crons": [
    {
      "path": "/api/agent/reflect",
      "schedule": "0 7 * * *"
    },
    {
      "path": "/api/agent/daily-insights",
      "schedule": "30 7 * * *"
    }
  ]
}
```

- [ ] **Step 5.3: Validate JSON**

```bash
cd /c/Users/thead/proyectosagentic-crm && node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"
```
Expected: no output (silent success). If error → revert and re-edit carefully.

- [ ] **Step 5.4: Commit**

```bash
cd /c/Users/thead/proyectosagentic-crm && git add vercel.json && git commit -m "feat(daily-insights): schedule cron at 7:30 UTC"
```

---

## Task 6: Smoke test the cron end-to-end (after Task 0 secret is set)

**Goal:** Before building UI, confirm the cron pipeline works — push, deploy, trigger manually, verify notifications inserted in Supabase.

**Files:** None (verification only).

- [ ] **Step 6.1: Push to origin**

```bash
cd /c/Users/thead/proyectosagentic-crm && git push origin master
```
Expected: push success.

- [ ] **Step 6.2: Deploy to Vercel prod**

```bash
cd /c/Users/thead/proyectosagentic-crm && npx vercel --prod --yes
```
Expected: build success, "Production https://proyectosagentic-crm.vercel.app" READY. Build takes ~50s.

- [ ] **Step 6.3: Manually trigger the cron**

Replace `<SECRET>` with the value the user pasted into Vercel in Task 0:

```bash
curl -s -H "Authorization: Bearer <SECRET>" https://proyectosagentic-crm.vercel.app/api/agent/daily-insights
```
Expected: JSON like `{"ok":true,"users_processed":N,"total_insights":M,"errors":[],"duration_ms":<n>}` where N matches the count of active reps+managers and M is the total stale leads across all reps. NO `errors`.

- [ ] **Step 6.4: Verify Supabase via MCP**

Use `mcp__plugin_supabase_supabase__execute_sql` on project `cwsyhjxbyyakcbxcwhib`:

```sql
select user_id, type, count(*) as n
from notifications
where created_at >= current_date
  and type in ('daily_summary','stale_lead')
group by user_id, type
order by user_id, type;
```
Expected: one `daily_summary` per active rep+manager, plus `stale_lead` rows where applicable. If the same query is run again (after re-triggering the cron), the row count should NOT grow (idempotency).

- [ ] **Step 6.5: Re-run cron to verify idempotency**

```bash
curl -s -H "Authorization: Bearer <SECRET>" https://proyectosagentic-crm.vercel.app/api/agent/daily-insights
```
Then re-run the SQL query from 6.4. The counts must be IDENTICAL to the previous run.

- [ ] **Step 6.6: Visual check in production**

Open https://proyectosagentic-crm.vercel.app/dashboard logged in as a rep that has stale leads (Honorina, Moe, or Andreina). Confirm:
- The `AgentSummaryCard` shows the new template text (e.g. "Hola Honorina. Tenés N leads sin contactar...")
- The notification bell shows a red badge with the count of stale_lead notifications
- Clicking the bell opens the dropdown with the lead names; clicking one navigates to `/leads/{id}`

If any of the 3 fail, stop and debug before continuing to UI tasks. Most likely culprits: rep doesn't actually have stale leads (try an admin temporarily added as rep), or the `AgentSummaryCard` is reading from a different date column than `created_at`.

**No commit** (verification only).

---

## Task 7: Create server actions `daily-insights-actions.ts`

**Goal:** Two server actions used by the UI panel: "create follow-up task" and "mark as contacted". They use the SSR client of the logged-in user (RLS applies).

**Files:**
- Create: `src/app/(app)/dashboard/_actions/daily-insights-actions.ts`

- [ ] **Step 7.1: Create the file**

```typescript
"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

/**
 * Crea una tarea de follow-up para un lead stale. Asignada al user actual,
 * priority 'high', due_at = today + 24h, source='agent' para distinguirla
 * de tareas manuales en filtros futuros.
 */
export async function createFollowUpTask(leadId: string, leadName: string) {
  const sb = await typedClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // brand_id del lead (necesario para la task)
  const { data: lead } = await sb
    .from("leads")
    .select("brand_id, assigned_rep_id")
    .eq("id", leadId)
    .single()

  if (!lead) throw new Error("Lead no encontrado")

  const dueAt = new Date(Date.now() + 86_400_000).toISOString()

  const { error } = await sb.from("tasks").insert({
    title: `Follow-up con ${leadName}`,
    description: "Generada desde Daily Insights — lead sin contacto reciente.",
    priority: "high",
    due_at: dueAt,
    related_lead_id: leadId,
    assigned_to: lead.assigned_rep_id ?? user.id,
    brand_id: lead.brand_id,
    status: "open",
    source: "agent",
  })

  if (error) throw new Error(error.message)

  revalidatePath("/dashboard")
  revalidatePath(`/leads/${leadId}`)
}

/**
 * Marca un lead como contactado (last_contacted_at = now). Útil cuando el rep
 * ve el lead en el panel y reconoce que ya lo contactó hoy, para sacarlo de la
 * lista al refrescar.
 */
export async function markAsContacted(leadId: string) {
  const sb = await typedClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { error } = await sb
    .from("leads")
    .update({ last_contacted_at: new Date().toISOString() })
    .eq("id", leadId)

  if (error) throw new Error(error.message)

  revalidatePath("/dashboard")
  revalidatePath(`/leads/${leadId}`)
}
```

- [ ] **Step 7.2: Typecheck**

```bash
cd /c/Users/thead/proyectosagentic-crm && npx tsc --noEmit
```
Expected: no errors. If `tasks.source` complains, check the actual enum values in `database.ts` (the bot already uses `'agent'` in `src/lib/agent/write-tools.ts:179` — same value works here).

- [ ] **Step 7.3: Commit**

```bash
cd /c/Users/thead/proyectosagentic-crm && git add "src/app/(app)/dashboard/_actions/daily-insights-actions.ts" && git commit -m "feat(daily-insights): server actions createFollowUpTask + markAsContacted"
```

---

## Task 8: Create UI component `daily-insights-panel.tsx`

**Goal:** Collapsible card showing stale leads with inline action buttons. Expanded by default if >0 leads, collapsed when empty.

**Files:**
- Create: `src/app/(app)/dashboard/_components/daily-insights-panel.tsx`

- [ ] **Step 8.1: Create the file**

```typescript
"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, ChevronRight, CheckCircle2, ListTodo, AlertCircle } from "lucide-react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  createFollowUpTask,
  markAsContacted,
} from "../_actions/daily-insights-actions"

export type DailyInsightLead = {
  id: string
  name: string
  brand_name: string
  days_stale: number
}

type Props = {
  leads: DailyInsightLead[]
}

export function DailyInsightsPanel({ leads }: Props) {
  const t = useTranslations("dashboard.dailyInsights")
  const hasLeads = leads.length > 0
  const [open, setOpen] = useState(hasLeads)
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function handleCreateFollowUp(leadId: string, leadName: string) {
    setBusyLeadId(leadId)
    startTransition(async () => {
      try {
        await createFollowUpTask(leadId, leadName)
      } finally {
        setBusyLeadId(null)
      }
    })
  }

  function handleMarkContacted(leadId: string) {
    setBusyLeadId(leadId)
    startTransition(async () => {
      try {
        await markAsContacted(leadId)
      } finally {
        setBusyLeadId(null)
      }
    })
  }

  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            {hasLeads ? (
              <AlertCircle className="w-4 h-4 text-amber-500" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            )}
            <span className="text-sm font-medium text-gray-900">
              {hasLeads
                ? t("collapsedWithCount", { count: leads.length })
                : t("collapsedAllGood")}
            </span>
          </div>
          {hasLeads && (
            <span className="text-gray-400">
              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>
          )}
        </button>

        {open && hasLeads && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
                    {t("columnLead")}
                  </th>
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
                    {t("columnDays")}
                  </th>
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">
                    {t("columnBrand")}
                  </th>
                  <th className="text-right text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2">
                    {t("columnActions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const isBusy = busyLeadId === lead.id
                  const daysText = lead.days_stale >= 9999 ? "—" : `${lead.days_stale}d`
                  return (
                    <tr key={lead.id} className="border-b border-gray-100">
                      <td className="py-2 pr-4">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="text-gray-800 hover:text-gray-900 font-medium"
                        >
                          {lead.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-gray-600 tabular-nums">{daysText}</td>
                      <td className="py-2 pr-4 hidden md:table-cell text-xs text-gray-400">
                        {lead.brand_name}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => handleCreateFollowUp(lead.id, lead.name)}
                            className="h-7 text-[11px] gap-1 border-gray-200 text-gray-700 hover:bg-gray-100"
                          >
                            <ListTodo className="w-3 h-3" />
                            {t("actionFollowUp")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => handleMarkContacted(lead.id)}
                            className="h-7 text-[11px] gap-1 border-gray-200 text-gray-700 hover:bg-gray-100"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {t("actionContacted")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 8.2: Typecheck**

```bash
cd /c/Users/thead/proyectosagentic-crm && npx tsc --noEmit
```
Expected: no errors. If `t("collapsedWithCount", { count: leads.length })` complains, ensure the i18n key includes the `{count}` placeholder in Task 10.

- [ ] **Step 8.3: Commit**

```bash
cd /c/Users/thead/proyectosagentic-crm && git add "src/app/(app)/dashboard/_components/daily-insights-panel.tsx" && git commit -m "feat(daily-insights): DailyInsightsPanel UI component"
```

---

## Task 9: Mount `DailyInsightsPanel` in `dashboard/page.tsx`

**Goal:** Read stale leads on the server (for the current user), pass to the panel, render in the existing PHASE B slot (between greeting and `AgentSummaryCard`).

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 9.1: Find the PHASE B slot**

Run:
```bash
cd /c/Users/thead/proyectosagentic-crm && grep -n "PHASE B" src/app/\(app\)/dashboard/page.tsx
```
Expected: line ~163 with `{/* PHASE B plug-in */}`. Note exact line for the Edit.

- [ ] **Step 9.2: Add import**

Use Edit to add the import block. Find the existing imports at the top of `src/app/(app)/dashboard/page.tsx` and add ONE NEW line:

```typescript
import { DailyInsightsPanel, type DailyInsightLead } from "./_components/daily-insights-panel"
import { detectStaleLeads } from "@/lib/agent/daily-insights"
```

- [ ] **Step 9.3: Fetch stale leads in the page (Server Component)**

Find where the page already does Server Component fetches (likely a `Promise.all` block near the top of the `default export async function`). Add ONE line to the parallel fetch:

```typescript
const staleLeadsRaw = await detectStaleLeads(sb, user.id).catch(() => [])
const staleLeadsForPanel: DailyInsightLead[] = staleLeadsRaw.map((l) => ({
  id: l.id,
  name: l.last_name ? `${l.first_name} ${l.last_name}` : l.first_name,
  brand_name: l.brand_name,
  days_stale: l.days_stale,
}))
```

Place this AFTER the `user` and `sb` are available but BEFORE the JSX return. If the page does parallel fetches with `Promise.all`, prefer to add it to the existing array for performance. If unclear, sequential is fine (1 extra query is negligible).

- [ ] **Step 9.4: Render the panel in PHASE B slot**

Use Edit to replace the existing comment line:

Old:
```
{/* PHASE B plug-in */}
```

New:
```
<DailyInsightsPanel leads={staleLeadsForPanel} />
```

- [ ] **Step 9.5: Typecheck**

```bash
cd /c/Users/thead/proyectosagentic-crm && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 9.6: Commit**

```bash
cd /c/Users/thead/proyectosagentic-crm && git add "src/app/(app)/dashboard/page.tsx" && git commit -m "feat(daily-insights): mount DailyInsightsPanel in dashboard"
```

---

## Task 10: Add i18n strings to `messages/es.json` and `en.json`

**Goal:** Translations for the panel under `dashboard.dailyInsights`.

**Files:**
- Modify: `messages/es.json`
- Modify: `messages/en.json`

- [ ] **Step 10.1: Read existing `dashboard` block in `es.json`**

```bash
cd /c/Users/thead/proyectosagentic-crm && grep -n '"dashboard"' messages/es.json
```
Note the line where `"dashboard": {` opens.

- [ ] **Step 10.2: Add new keys under `dashboard` in `es.json`**

Find the closing `}` of the existing `"dashboard": { ... }` block. Use Edit to insert a comma after the last existing key and add this block BEFORE the closing brace:

```json
,
    "dailyInsights": {
      "title": "Insights del día",
      "collapsedAllGood": "✓ Estás al día",
      "collapsedWithCount": "{count} leads necesitan atención",
      "columnLead": "Lead",
      "columnDays": "Días sin contacto",
      "columnBrand": "Marca",
      "columnActions": "Acciones",
      "actionFollowUp": "Crear follow-up",
      "actionContacted": "Marcar contactado",
      "regenerateFallback": "No se pudo personalizar con IA, se mantiene el mensaje original."
    }
```

(Preserve indentation that matches surrounding keys; the example above uses 4-space, adapt to file's actual indentation.)

- [ ] **Step 10.3: Validate ES JSON**

```bash
cd /c/Users/thead/proyectosagentic-crm && node -e "JSON.parse(require('fs').readFileSync('messages/es.json','utf8'))"
```
Expected: silent success. If error: revert and re-edit.

- [ ] **Step 10.4: Repeat for `en.json`**

Add to `messages/en.json` under the `"dashboard"` block:

```json
,
    "dailyInsights": {
      "title": "Today's insights",
      "collapsedAllGood": "✓ You're all caught up",
      "collapsedWithCount": "{count} leads need attention",
      "columnLead": "Lead",
      "columnDays": "Days since contact",
      "columnBrand": "Brand",
      "columnActions": "Actions",
      "actionFollowUp": "Create follow-up",
      "actionContacted": "Mark contacted",
      "regenerateFallback": "Could not personalize with AI, keeping original message."
    }
```

- [ ] **Step 10.5: Validate EN JSON**

```bash
cd /c/Users/thead/proyectosagentic-crm && node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'))"
```
Expected: silent success.

- [ ] **Step 10.6: Commit**

```bash
cd /c/Users/thead/proyectosagentic-crm && git add messages/es.json messages/en.json && git commit -m "feat(daily-insights): i18n strings es/en for dashboard.dailyInsights"
```

---

## Task 11: Add `buildSummaryWithClaude` to `daily-insights.ts`

**Goal:** Pure function that calls Claude with the stale leads list and returns a personalized `{subject, body}`. Used only by the regenerate on-demand action.

**Files:**
- Modify: `src/lib/agent/daily-insights.ts` (append)

- [ ] **Step 11.1: Append `buildSummaryWithClaude`**

```typescript
import Anthropic from "@anthropic-ai/sdk"

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

  const leadsContext = staleLeads.slice(0, 10).map((l) => {
    const name = l.last_name ? `${l.first_name} ${l.last_name}` : l.first_name
    const days = l.days_stale >= 9999 ? "nunca contactado" : `${l.days_stale} días`
    return `- ${name} (${l.brand_name}) — ${days}`
  }).join("\n")

  const langInstr = locale === "en" ? "Respond in English." : "Responde en español, tono natural y cálido."

  const prompt = locale === "en"
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
  const subject = firstSentence.length > 60 ? firstSentence.slice(0, 57) + "..." : firstSentence

  return { subject, body: text }
}
```

- [ ] **Step 11.2: Typecheck**

```bash
cd /c/Users/thead/proyectosagentic-crm && npx tsc --noEmit
```
Expected: no errors. `@anthropic-ai/sdk` is already a dependency (used in `src/app/api/agent/ask/route.ts`).

- [ ] **Step 11.3: Commit**

```bash
cd /c/Users/thead/proyectosagentic-crm && git add src/lib/agent/daily-insights.ts && git commit -m "feat(daily-insights): buildSummaryWithClaude for on-demand regenerate"
```

---

## Task 12: Implement `regenerateAgentSummary` in `dashboard/actions.ts`

**Goal:** The button on `AgentSummaryCard` (today a no-op) now actually regenerates the daily summary text with Claude. Falls back to template if Claude fails.

**Files:**
- Modify: `src/app/(app)/dashboard/actions.ts`

- [ ] **Step 12.1: Read the current `regenerateAgentSummary`**

```bash
cd /c/Users/thead/proyectosagentic-crm && grep -n -A 10 "regenerateAgentSummary" src/app/\(app\)/dashboard/actions.ts
```
Expected: existing function with comment `// Phase 1: no-op` and probably just a `revalidatePath`.

- [ ] **Step 12.2: Replace the no-op body**

Use Edit to replace the function. The new implementation:

```typescript
export async function regenerateAgentSummary() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const sb = supabase as unknown as SupabaseClient<Database>

  // Fetch user name (for personalization)
  const { data: profile } = await sb
    .from("users")
    .select("name")
    .eq("id", user.id)
    .single()
  const repFirstName = (profile?.name ?? "").split(/\s+/)[0] || "Hola"

  // Today's stale leads
  const staleLeads = await detectStaleLeads(sb, user.id)

  // Find today's existing daily_summary notification
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart.getTime() + 86_400_000)

  const { data: existing } = await sb
    .from("notifications")
    .select("id")
    .eq("user_id", user.id)
    .eq("type", "daily_summary")
    .gte("created_at", todayStart.toISOString())
    .lt("created_at", todayEnd.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  // Try Claude; fall back to template
  let payload: { subject: string; body: string }
  let usedFallback = false
  try {
    payload = await buildSummaryWithClaude(staleLeads, repFirstName, "es")
  } catch (err) {
    console.error("[regenerateAgentSummary] Claude failed, using template:", err)
    payload = buildSummaryTemplate(staleLeads, "es", repFirstName)
    usedFallback = true
  }

  if (existing?.id) {
    await sb
      .from("notifications")
      .update({ subject: payload.subject, body: payload.body })
      .eq("id", existing.id)
  } else {
    // No row from cron yet (e.g. first day or rep was missing) — INSERT fresh
    await sb.from("notifications").insert({
      user_id: user.id,
      channel: "in_app",
      type: "daily_summary",
      subject: payload.subject,
      body: payload.body,
      sent_at: new Date().toISOString(),
    })
  }

  revalidatePath("/dashboard")
  return { ok: true, used_fallback: usedFallback }
}
```

- [ ] **Step 12.3: Add missing imports at top of `actions.ts`**

If not already present:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import {
  detectStaleLeads,
  buildSummaryTemplate,
  buildSummaryWithClaude,
} from "@/lib/agent/daily-insights"
```

- [ ] **Step 12.4: Typecheck**

```bash
cd /c/Users/thead/proyectosagentic-crm && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 12.5: Commit**

```bash
cd /c/Users/thead/proyectosagentic-crm && git add "src/app/(app)/dashboard/actions.ts" && git commit -m "feat(daily-insights): regenerateAgentSummary now calls Claude with template fallback"
```

---

## Task 13: Final smoke test E2E + deploy

**Goal:** Verify the whole flow in production with real data, then leave the system live.

**Files:** None.

- [ ] **Step 13.1: Push all commits**

```bash
cd /c/Users/thead/proyectosagentic-crm && git push origin master
```
Expected: pushes Tasks 1-12 commits.

- [ ] **Step 13.2: Deploy to Vercel prod**

```bash
cd /c/Users/thead/proyectosagentic-crm && npx vercel --prod --yes
```
Expected: build success, status READY.

- [ ] **Step 13.3: Trigger the cron one more time (live now with the panel)**

Replace `<SECRET>`:
```bash
curl -s -H "Authorization: Bearer <SECRET>" https://proyectosagentic-crm.vercel.app/api/agent/daily-insights | python -m json.tool
```
Expected: `{"ok": true, "users_processed": N, "total_insights": M, "errors": [], "duration_ms": <n>}`.

- [ ] **Step 13.4: Open the dashboard as a rep**

Open https://proyectosagentic-crm.vercel.app/dashboard as Honorina or Moe. Verify:
- `DailyInsightsPanel` appears between the greeting and `AgentSummaryCard`
- If they have stale leads: panel is **expanded** with a table; if not: panel shows "✓ Estás al día" collapsed
- `AgentSummaryCard` text is the template ("Hola Honorina. Tenés N leads sin contactar...")
- Notification bell shows a red badge with the stale lead count
- Click bell → dropdown shows the lead names; click a lead → navigates to `/leads/{id}`

- [ ] **Step 13.5: Test the action buttons**

In the panel, for one lead click "Crear follow-up":
- Verify in Supabase: `select * from tasks where related_lead_id = '<lead-id>' order by created_at desc limit 1;` → returns the new task with `source='agent'`, `priority='high'`, `due_at` ~24h from now.
- Refresh dashboard — the lead may still appear (the task doesn't change `last_contacted_at`). That's expected.

In the panel, for another lead click "Marcar contactado":
- Refresh dashboard — that lead should DISAPPEAR from the panel (its `last_contacted_at` is now, below the 5-day threshold).
- Verify in Supabase: `select last_contacted_at from leads where id = '<lead-id>';` → recent timestamp.

- [ ] **Step 13.6: Test the Regenerate button**

In `AgentSummaryCard`, click the regenerate icon (`RotateCcw`). After ~2-3s:
- The body text changes from the template to a more conversational Claude-generated paragraph
- If `ANTHROPIC_API_KEY` is misconfigured, the text falls back to the template silently (check browser console / network for errors)
- Verify in Supabase: `select subject, body from notifications where user_id = '<your-id>' and type = 'daily_summary' and date(created_at) = current_date;` → updated subject/body matching what you see.

- [ ] **Step 13.7: Final visual screenshot to user**

Tell the user the deployment is live and ask them to open the dashboard. Capture any feedback for follow-ups.

**No commit** (verification only).

---

## Self-Review (engineer reading this plan)

Before declaring this plan complete, check:

1. **Spec coverage:** Every section of `docs/superpowers/specs/2026-05-19-daily-insights-stale-leads-design.md` has a Task that implements it:
   - ✅ Cron at 7:30 UTC → Task 5
   - ✅ `detectStaleLeads` reusing `fetchUrgentLeads` logic → Task 1
   - ✅ Template (deterministic, bilingual) → Task 2
   - ✅ Claude regenerate with fallback → Tasks 11 + 12
   - ✅ Idempotency (DELETE+INSERT per day) → Task 3
   - ✅ `notifications` writes (`daily_summary` + `stale_lead`) → Task 3
   - ✅ `DailyInsightsPanel` UI in PHASE B slot → Tasks 8 + 9
   - ✅ Inline actions (create task, mark contacted) → Task 7
   - ✅ i18n es/en → Task 10
   - ✅ `CRON_SECRET` setup → Task 0
   - ✅ Cron endpoint with auth → Task 4
   - ✅ Smoke tests → Tasks 6 + 13

2. **No placeholders:** Search the plan for "TBD", "TODO", "implement later", "appropriate", "handle edge cases", etc. None found at writing time. Every step has either exact code or an exact command.

3. **Type consistency:**
   - `StaleLead` type used identically across all tasks (Task 1 defines, Tasks 2/3/8/11 consume)
   - `Locale` type ("es" | "en") consistent
   - `DailyInsightLead` (UI shape) defined in Task 8, consumed in Task 9 — consistent
   - Function names: `detectStaleLeads`, `buildSummaryTemplate`, `buildSummaryWithClaude`, `generateForRep`, `generateDailyInsightsForAllReps` — all consistent across tasks

4. **Order dependencies:**
   - Task 0 must complete before Task 6 (smoke test needs the secret)
   - Tasks 1 → 2 → 3 build on the same file additively
   - Task 6 smoke-tests the cron — must run AFTER Tasks 1-5 are committed and deployed
   - Task 13 final E2E runs AFTER Tasks 7-12 (all UI + regenerate)

---

## Execution recommendation

This plan has 13 sequential tasks. Best executed with **subagent-driven development** (the writing-plans default): dispatch one subagent per task, review the resulting commit before moving to the next. That way if Task N breaks something, you catch it immediately instead of debugging at Task 13.

Alternative: inline execution in this session if speed matters more than isolation.

Estimated total: 1.5-2 days of agent time (matches spec estimate).
