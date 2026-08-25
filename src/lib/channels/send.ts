import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentRole, assertNotProvider } from "@/lib/auth/role-guards"
import { getAdapter } from "./registry"
import type { ChannelKey } from "./types"

/**
 * Camino ÚNICO de salida, compartido por todos los canales.
 *
 * Todo lo que protege al paciente vive aquí y se aplica igual para SMS,
 * WhatsApp y lo que venga: rol, membresía de marca, que el lead sea de esa
 * marca, el opt-out del canal y la política propia del canal (la ventana de 24h
 * de Meta). El adaptador solo se encarga de mandar.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

export type SendMessageInput = {
  channel: ChannelKey
  leadId: string
  brandId: string
  userId?: string
  body?: string
  template?: { name: string; language: string; params?: string[] }
}

export type SendMessageResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string }

/** Membresía de marca. Admin pasa siempre; el resto debe estar en user_brands. */
async function assertBrandMember(
  sb: SupabaseClient<Database>,
  userId: string,
  role: string,
  brandId: string,
): Promise<boolean> {
  if (role === "admin") return true
  const { data } = await sb
    .from("user_brands")
    .select("brand_id")
    .eq("user_id", userId)
    .eq("brand_id", brandId)
    .maybeSingle()
  return !!data
}

export async function sendChannelMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const adapter = getAdapter(input.channel)
  if (!adapter) return { ok: false, error: "Canal no soportado." }

  const sb = (await createClient()) as unknown as SupabaseClient<Database>
  const { userId, role } = await getCurrentRole(sb)
  assertNotProvider(role)
  if (!(await assertBrandMember(sb, userId, role, input.brandId))) {
    return { ok: false, error: "Sin acceso a esta marca." }
  }

  // Las columnas de opt-out son nuevas (no están en los tipos generados) y
  // cambian por canal → lectura sin tipar, con el nombre que dice el adaptador.
  const { data: leadRaw } = await (sb as AnyClient)
    .from("leads")
    .select(`phone, brand_id, ${adapter.optOut.column}`)
    .eq("id", input.leadId)
    .single()
  const lead = leadRaw as (Record<string, unknown> & { phone: string | null; brand_id: string }) | null
  if (!lead || lead.brand_id !== input.brandId) {
    return { ok: false, error: "El paciente no es válido para esta marca." }
  }
  if (lead[adapter.optOut.column] === true) {
    return {
      ok: false,
      error:
        adapter.key === "whatsapp"
          ? "El paciente pidió no recibir WhatsApp (respondió STOP/BAJA)."
          : "El paciente pidió no recibir mensajes (respondió STOP).",
    }
  }
  const to = lead.phone
  if (!to || !to.startsWith("+")) {
    return { ok: false, error: "El paciente no tiene un teléfono válido (formato +1…)." }
  }

  const args = {
    brandId: input.brandId,
    leadId: input.leadId,
    to,
    body: input.body,
    template: input.template,
  }

  // Política propia del canal (WhatsApp: ventana de 24h). Se valida EN EL
  // SERVIDOR: el cliente solo la usa para pintar el formulario correcto.
  if (adapter.checkSendPolicy) {
    const policy = await adapter.checkSendPolicy(args)
    if (!policy.ok) return policy
  }

  const sent = await adapter.send(args)
  if (!sent.ok) return sent

  // Registrar el saliente (messages es service-role para escribir).
  const admin = createAdminClient() as AnyClient
  const { error: insErr } = await admin.from("messages").insert({
    provider: adapter.provider,
    brand_id: input.brandId,
    lead_id: input.leadId,
    direction: "out",
    channel: adapter.key,
    body: sent.threadBody,
    from_number: sent.from,
    to_number: to,
    external_id: sent.externalId || null,
    status: "sent",
    created_by: userId,
    ...(input.template ? { raw: { template: input.template } } : {}),
  })
  if (insErr) {
    // El mensaje SÍ se envió; solo no se registró en el hilo. Avisar para que el
    // vendedor no lo reenvíe.
    console.error(`[send:${adapter.key}] registro:`, insErr.message)
    return {
      ok: true,
      warning: "El mensaje se envió, pero no se pudo registrar en el hilo (no lo reenvíes).",
    }
  }
  return { ok: true }
}
