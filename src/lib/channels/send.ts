import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentRole, assertNotProvider } from "@/lib/auth/role-guards"
import { getAdapter } from "./registry"
import type { ChannelAdapter, ChannelKey, SendArgs } from "./types"

/**
 * Camino ÚNICO de salida, compartido por todos los canales Y por sus dos
 * llamadores: una persona desde la ficha, y el bot desde el webhook.
 *
 * La estructura importa: TODO lo que protege al paciente vive en el núcleo
 * (`resolveSendTarget` + `deliver`) y lo comparten las dos entradas. Así, cuando
 * alguien agregue un guard nuevo, le aplica a las dos por construcción — no se
 * puede "olvidar" en el camino del bot.
 *
 * Lo ÚNICO que no comparten es el guard de ROL humano, porque un bot no tiene
 * sesión. Los guards de paciente (marca del lead, opt-out del canal, ventana de
 * 24h de Meta) se aplican igual en ambas.
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

/**
 * Guards de PACIENTE: que el lead sea de esta marca, que no haya pedido no
 * recibir por este canal, y que tenga teléfono usable.
 *
 * `sb` se recibe como PARÁMETRO a propósito. La entrada humana pasa el cliente
 * de SESIÓN, y así la RLS de `leads` sigue actuando como capa extra (un rep sin
 * acceso a ese lead recibe null → "no válido"). Si este núcleo creara su propio
 * admin client, el camino humano perdería esa capa en silencio y ningún test de
 * tipos lo notaría.
 */
async function resolveSendTarget(
  sb: SupabaseClient<Database>,
  adapter: ChannelAdapter,
  input: { leadId: string; brandId: string },
): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
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
  return { ok: true, to }
}

/**
 * Política del canal + envío + registro en el hilo. Es la segunda mitad del
 * núcleo, también compartida.
 *
 * `shadow` = generar y REGISTRAR lo que se habría mandado, sin mandarlo. Sirve
 * para ver en la bandeja qué contesta el bot antes de soltarlo con pacientes.
 */
async function deliver(
  adapter: ChannelAdapter,
  args: SendArgs,
  opts: { createdBy: string | null; sentBy: "user" | "bot"; shadow?: boolean },
): Promise<SendMessageResult> {
  // Política propia del canal (WhatsApp: ventana de 24h). Se valida EN EL
  // SERVIDOR: el cliente solo la usa para pintar el formulario correcto.
  if (adapter.checkSendPolicy) {
    const policy = await adapter.checkSendPolicy(args)
    if (!policy.ok) return policy
  }

  let externalId = ""
  let from = ""
  let threadBody = args.body ?? ""

  if (opts.shadow) {
    // No se manda nada. Se registra con status 'dry_run' para poder leerlo.
    threadBody = args.body ?? `[plantilla: ${args.template?.name ?? "?"}]`
  } else {
    const sent = await adapter.send(args)
    if (!sent.ok) return sent
    externalId = sent.externalId
    from = sent.from
    threadBody = sent.threadBody
  }

  // Registrar el saliente (messages es service-role para escribir).
  const admin = createAdminClient() as AnyClient
  const { error: insErr } = await admin.from("messages").insert({
    provider: adapter.provider,
    brand_id: args.brandId,
    lead_id: args.leadId,
    direction: "out",
    channel: adapter.key,
    body: threadBody,
    from_number: from || null,
    to_number: args.to,
    external_id: externalId || null,
    status: opts.shadow ? "dry_run" : "sent",
    created_by: opts.createdBy,
    raw: {
      sent_by: opts.sentBy,
      ...(args.template ? { template: args.template } : {}),
      ...(opts.shadow ? { shadow: true } : {}),
    },
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

// ── Entrada 1: una PERSONA, desde la ficha o la bandeja ──────────────────────

export async function sendChannelMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const adapter = getAdapter(input.channel)
  if (!adapter) return { ok: false, error: "Canal no soportado." }

  const sb = (await createClient()) as unknown as SupabaseClient<Database>
  const { userId, role } = await getCurrentRole(sb)
  assertNotProvider(role)
  if (!(await assertBrandMember(sb, userId, role, input.brandId))) {
    return { ok: false, error: "Sin acceso a esta marca." }
  }

  // Cliente de SESIÓN: conserva la RLS de `leads` como capa extra.
  const target = await resolveSendTarget(sb, adapter, input)
  if (!target.ok) return target

  return deliver(
    adapter,
    {
      brandId: input.brandId,
      leadId: input.leadId,
      to: target.to,
      body: input.body,
      template: input.template,
    },
    { createdBy: userId, sentBy: "user" },
  )
}

// ── Entrada 2: el BOT, desde el webhook (sin sesión de usuario) ──────────────

export type SystemSendInput = {
  /** Fase 1: solo WhatsApp. El bot no manda SMS. */
  channel: Extract<ChannelKey, "whatsapp">
  leadId: string
  brandId: string
  body: string
  /** true = generar y registrar sin enviar (modo shadow de la marca). */
  shadow?: boolean
}

/**
 * Envío sin sesión de usuario. Lo usa el bot de WhatsApp desde el webhook.
 *
 * Qué NO se afloja: pasa por el MISMO núcleo, así que sigue verificando que el
 * lead sea de la marca, que no haya opt-out y que la ventana de 24h esté
 * abierta. Lo único que no corre es el guard de rol humano, que no aplica.
 *
 * Qué se PROHÍBE a propósito:
 *  - plantillas: una plantilla reabre una conversación cerrada, y el bot no
 *    tiene por qué perseguir a nadie. Si la ventana está cerrada, el bot calla.
 *  - SMS: fuera del alcance de la Fase 1.
 */
export async function sendChannelMessageAsSystem(
  input: SystemSendInput,
): Promise<SendMessageResult> {
  const adapter = getAdapter(input.channel)
  if (!adapter) return { ok: false, error: "Canal no soportado." }

  const body = input.body?.trim()
  if (!body) return { ok: false, error: "El mensaje del bot venía vacío." }

  // Service role: el webhook no tiene sesión. La autorización que sustituye a la
  // RLS es que el llamador ya resolvió la marca desde el `phone_number_id` que
  // recibió el mensaje, y que el núcleo vuelve a exigir que el lead sea de ESA
  // marca — no de la que venga en el argumento por casualidad.
  const admin = createAdminClient() as unknown as SupabaseClient<Database>

  const target = await resolveSendTarget(admin, adapter, input)
  if (!target.ok) return target

  return deliver(
    adapter,
    { brandId: input.brandId, leadId: input.leadId, to: target.to, body },
    { createdBy: null, sentBy: "bot", shadow: input.shadow },
  )
}
