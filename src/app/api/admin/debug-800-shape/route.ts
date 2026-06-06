/**
 * Debug temporal #2: diagnosticar por qué backfill leads dice "18 sin info".
 * Compara caller_e164 de orphan calls vs recipient de conversations 800.com.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { listConversationsPage } from "@/lib/integrations/800com"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function normalizePhone(s: string | null | undefined): string | null {
  if (!s) return null
  const cleaned = s.replace(/[^\d+]/g, "")
  return cleaned || null
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const hermesSecret = process.env.HERMES_SECRET
  const auth = req.headers.get("authorization") ?? ""
  const ok =
    (!!cronSecret && auth === `Bearer ${cronSecret}`) ||
    (!!hermesSecret && auth === `Bearer ${hermesSecret}`)
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyIdNum = parseInt(process.env.EIGHTHUNDRED_COMPANY_ID!, 10)
  const sb = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 1) Orphan calls
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orphanRows } = await (sb as any)
    .from("calls")
    .select("id, external_id, brand_id, called_at, caller_e164")
    .is("lead_id", null)
    .eq("source", "800com")
    .gte("called_at", since)
    .order("called_at", { ascending: false })
    .limit(10)
  const orphans = (orphanRows ?? []) as Array<{
    id: string
    external_id: string
    brand_id: string
    called_at: string
    caller_e164: string | null
  }>

  // 2) Conversations from 800.com (1ra página)
  const convPage = await listConversationsPage({
    companyId: companyIdNum,
    perPage: 100,
  })
  const conversationsByPhone = new Map<string, { recipient: string; firstName: string | null; lastName: string | null; nameField: string | null }>()
  for (const conv of convPage.data) {
    const key = normalizePhone(conv.recipient)
    if (!key) continue
    conversationsByPhone.set(key, {
      recipient: conv.recipient,
      firstName: conv.enhancedCallerId?.firstName ?? null,
      lastName: conv.enhancedCallerId?.lastName ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nameField: (conv.enhancedCallerId as any)?.name ?? null,
    })
  }

  // 3) Match diagnostics
  const matches = orphans.map((o) => {
    const phone = normalizePhone(o.caller_e164)
    const conv = phone ? conversationsByPhone.get(phone) : null
    return {
      orphan_id: o.id,
      orphan_caller_e164_raw: o.caller_e164,
      orphan_caller_normalized: phone,
      matched_conversation: conv ? {
        recipient: conv.recipient,
        firstName: conv.firstName,
        lastName: conv.lastName,
        name: conv.nameField,
      } : null,
    }
  })

  return NextResponse.json({
    ok: true,
    orphans_count: orphans.length,
    conversations_count: convPage.data.length,
    sample_conversation_recipients: Array.from(conversationsByPhone.values()).slice(0, 5),
    matches,
  })
}
