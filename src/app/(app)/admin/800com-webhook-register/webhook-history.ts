"use server"

import { createClient } from "@/lib/supabase/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type DB = SupabaseClient<Database>

const API_BASE = "https://api.800.com"

function getEnv() {
  const apiKey = process.env.EIGHTHUNDRED_API_KEY
  const companyId = process.env.EIGHTHUNDRED_COMPANY_ID
  if (!apiKey) throw new Error("EIGHTHUNDRED_API_KEY no configurado")
  if (!companyId) throw new Error("EIGHTHUNDRED_COMPANY_ID no configurado")
  return { apiKey, companyId }
}

async function assertAdmin() {
  const supabase = (await createClient()) as unknown as DB
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") throw new Error("Solo admin")
}

export type WebhookHistoryItem = {
  id: number
  method: string
  url: string
  feature: string
  httpResponseCode: number | null
  createdAt: string
}

export async function fetchWebhookHistory(
  webhookId: number,
): Promise<
  | { ok: true; items: WebhookHistoryItem[] }
  | { ok: false; error: string }
> {
  try {
    await assertAdmin()
    const { apiKey, companyId } = getEnv()
    const res = await fetch(
      `${API_BASE}/v2/companies/${companyId}/webhooks/${webhookId}/history`,
      {
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        cache: "no-store",
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { ok: false, error: `${res.status}: ${text.slice(0, 300)}` }
    }
    const json = (await res.json()) as { data?: WebhookHistoryItem[] }
    return { ok: true, items: json.data ?? [] }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function fetchWebhookHistoryDetail(
  webhookId: number,
  historyId: number,
): Promise<
  | { ok: true; detail: WebhookHistoryItem & { payload?: unknown } }
  | { ok: false; error: string }
> {
  try {
    await assertAdmin()
    const { apiKey, companyId } = getEnv()
    const res = await fetch(
      `${API_BASE}/v2/companies/${companyId}/webhooks/${webhookId}/history/${historyId}`,
      {
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        cache: "no-store",
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { ok: false, error: `${res.status}: ${text.slice(0, 300)}` }
    }
    const json = (await res.json()) as { data?: WebhookHistoryItem & { payload?: unknown } }
    if (!json.data) return { ok: false, error: "respuesta sin data" }
    return { ok: true, detail: json.data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
