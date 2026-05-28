import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { listWebhooks, registerWebhook, deleteWebhook } from "./actions"
import { fetchWebhookHistory, fetchWebhookHistoryDetail } from "./webhook-history"
import { RegisterWebhookClient } from "./_components/register-webhook-client"
import { WebhookHistoryViewer } from "./_components/webhook-history-viewer"

type TypedClient = SupabaseClient<Database>

export const dynamic = "force-dynamic"

/**
 * Admin page: registrar / listar / borrar webhooks de 800.com.
 *
 * Para activar real-time updates:
 *   1. Verificar que EIGHTHUNDRED_WEBHOOK_SECRET está en Vercel env
 *   2. Click "Register webhook" — registra apuntando a /api/webhooks/800com/voice
 *      con todos los events relevantes
 *   3. Hacer call real al tracking number — debe aparecer en /calls al instante
 */
export default async function EightHundredWebhookRegisterPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") redirect("/dashboard")

  let webhooks: Awaited<ReturnType<typeof listWebhooks>> = { ok: false, error: "not loaded" }
  try {
    webhooks = await listWebhooks()
  } catch (e) {
    webhooks = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const webhookSecretConfigured = Boolean(process.env.EIGHTHUNDRED_WEBHOOK_SECRET)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          800.com — Webhooks (real-time setup)
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Registrar webhook receiver para que las calls lleguen al CRM al instante
          (sin esperar el polling cron de 15min). Solo admin.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded p-4 text-xs text-amber-900 space-y-2">
        <p className="font-semibold">📋 Pre-requisito</p>
        <p>
          La env var <code>EIGHTHUNDRED_WEBHOOK_SECRET</code> en Vercel está{" "}
          {webhookSecretConfigured ? (
            <span className="text-emerald-700 font-semibold">✓ configurada</span>
          ) : (
            <span className="text-red-700 font-semibold">✗ NO configurada</span>
          )}
          .
        </p>
        {!webhookSecretConfigured && (
          <p>
            Antes de registrar, agrega a Vercel env (marcada Sensitive):{" "}
            <code>EIGHTHUNDRED_WEBHOOK_SECRET</code> = un string random largo
            (ej. el output de <code>openssl rand -hex 32</code>). Después redeploy.
          </p>
        )}
      </div>

      <RegisterWebhookClient
        initialResult={webhooks}
        canRegister={webhookSecretConfigured}
        registerAction={registerWebhook}
        deleteAction={deleteWebhook}
      />

      <div className="space-y-2 pt-4 border-t border-gray-200">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Delivery history
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Qué eventos 800.com intentó enviar y qué respondió nuestro endpoint.
            Útil para diagnosticar por qué un call no aparece en /calls.
          </p>
        </div>
        <WebhookHistoryViewer
          webhookIds={webhooks.ok ? webhooks.webhooks.map((w) => w.id) : []}
          loadHistory={fetchWebhookHistory}
          loadDetail={fetchWebhookHistoryDetail}
        />
      </div>
    </div>
  )
}
