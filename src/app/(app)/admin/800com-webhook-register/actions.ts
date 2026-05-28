"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
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

export type WebhookItem = {
  id: number
  url: string
  method: string
  features: string[]
}

export async function listWebhooks(): Promise<
  | { ok: true; webhooks: WebhookItem[] }
  | { ok: false; error: string }
> {
  try {
    await assertAdmin()
    const { apiKey, companyId } = getEnv()
    const res = await fetch(
      `${API_BASE}/v2/companies/${companyId}/webhooks`,
      {
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        cache: "no-store",
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { ok: false, error: `${res.status}: ${text.slice(0, 300)}` }
    }
    const json = (await res.json()) as { data?: WebhookItem[] }
    return { ok: true, webhooks: json.data ?? [] }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Registra el webhook apuntando a /api/webhooks/800com/voice con el secret
 * como query param.
 *
 * Asume que VERCEL_URL o NEXT_PUBLIC_SITE_URL apunta al dominio prod.
 * Si no, hardcoded fallback a proyectosagentic-crm.vercel.app.
 */
export async function registerWebhook(): Promise<
  | { ok: true; webhook: WebhookItem }
  | { ok: false; error: string }
> {
  try {
    await assertAdmin()
    const { apiKey, companyId } = getEnv()
    const secret = process.env.EIGHTHUNDRED_WEBHOOK_SECRET
    if (!secret) {
      return { ok: false, error: "EIGHTHUNDRED_WEBHOOK_SECRET no configurado" }
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
      "https://proyectosagentic-crm.vercel.app"
    const webhookUrl = `${baseUrl}/api/webhooks/800com/voice?secret=${encodeURIComponent(secret)}`

    const res = await fetch(
      `${API_BASE}/v2/companies/${companyId}/webhooks`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          url: webhookUrl,
          method: "POST",
          features: ["call_started", "call_completed", "call_decorated", "call_updated"],
        }),
        cache: "no-store",
      },
    )

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { ok: false, error: `${res.status}: ${text.slice(0, 500)}` }
    }
    const json = (await res.json()) as { data?: WebhookItem }
    if (!json.data) return { ok: false, error: "respuesta sin data" }

    revalidatePath("/admin/800com-webhook-register")
    return { ok: true, webhook: json.data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deleteWebhook(webhookId: number): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  try {
    await assertAdmin()
    const { apiKey, companyId } = getEnv()
    const res = await fetch(
      `${API_BASE}/v2/companies/${companyId}/webhooks/${webhookId}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${apiKey}` },
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { ok: false, error: `${res.status}: ${text.slice(0, 300)}` }
    }
    revalidatePath("/admin/800com-webhook-register")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
