"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import {
  detectStaleLeads,
  buildSummaryTemplate,
  buildSummaryWithClaude,
} from "@/lib/agent/daily-insights"

// Cast to bypass @supabase/ssr ↔ @supabase/supabase-js@2.46 generic mismatch
async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

export async function confirmAppointment(appointmentId: string, _: FormData) {
  const supabase = await typedClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  await supabase
    .from("appointments")
    .update({ status: "confirmed" })
    .eq("id", appointmentId)
    .eq("rep_id", user.id)

  revalidatePath("/dashboard")
}

export async function dismissUrgentLead(leadId: string, _reason: string, _: FormData) {
  // Resets last_contacted_at so the lead exits "stale" state
  // PHASE B plug-in: queue agent action to log dismissal reason
  const supabase = await typedClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  await supabase
    .from("leads")
    .update({ last_contacted_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("assigned_rep_id", user.id)

  revalidatePath("/dashboard")
}

export async function logQuickCall(leadId: string, _: FormData) {
  // Creates a minimal outbound call record — full modal comes Week 2
  const supabase = await typedClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: lead } = await supabase
    .from("leads")
    .select("brand_id")
    .eq("id", leadId)
    .eq("assigned_rep_id", user.id)
    .maybeSingle()

  if (!lead) return

  await supabase.from("calls").insert({
    rep_id: user.id,
    lead_id: leadId,
    brand_id: lead.brand_id,
    direction: "outbound",
    source: "crm_quick",
  })

  await supabase
    .from("leads")
    .update({ last_contacted_at: new Date().toISOString() })
    .eq("id", leadId)

  revalidatePath("/dashboard")
}

export async function regenerateAgentSummary(_?: FormData) {
  const sb = await typedClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error("Unauthorized")

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
  try {
    payload = await buildSummaryWithClaude(staleLeads, repFirstName, "es")
  } catch (err) {
    console.error("[regenerateAgentSummary] Claude failed, using template:", err)
    payload = buildSummaryTemplate(staleLeads, "es", repFirstName)
  }

  if (existing?.id) {
    await sb
      .from("notifications")
      .update({ subject: payload.subject, body: payload.body })
      .eq("id", existing.id)
  } else {
    // No row from cron yet — INSERT fresh
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
}
