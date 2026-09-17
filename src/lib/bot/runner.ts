import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeToE164 } from "@/lib/integrations/800com"
import { resolveBrandByWhatsAppPhoneId } from "@/lib/integrations/brand-numbers"
import { sendChannelMessageAsSystem } from "@/lib/channels/send"
import { dispatchOutboundCallForBot, isWithinCallingHours } from "@/lib/voice/outbound"
import { runBotTurn, CONSENT_PROMPT, type BotTurn } from "./whatsapp-agent"

/**
 * Orquestador del bot de WhatsApp. Aquí viven los guards; el modelo solo redacta.
 *
 * Orden que importa (y por qué):
 *  1. La MARCA sale del `phone_number_id` que recibió el mensaje. NUNCA del lead.
 *     Si alguien ya es paciente de otra clínica y escribe al número de anuncios
 *     de esta, el bot tiene que contestar con el guion de ESTA.
 *  2. El interruptor se lee de la BASE en cada mensaje, por marca. Un env var
 *     exigiría redeploy para apagarlo, y el webhook es uno solo para todos los
 *     números de la app — incluido el que contesta una persona.
 *  3. Primero el CANDADO de conversación, después el claim de los mensajes. Si
 *     llegan cinco mensajes seguidos, cada uno es una invocación distinta del
 *     webhook: sin candado serían cinco modelos contestando en paralelo. El que
 *     gana el candado se lleva TODOS los pendientes en una sola vuelta.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

/** Techo de turnos del bot por conversación: corta bucles y acota el gasto. */
const MAX_TURNS = 8
/** Cuánto retiene el candado. Más que lo que tarda una vuelta, menos que un plantón. */
const LOCK_MS = 90_000
/** Cuántas veces vuelve a mirar si llegaron mensajes mientras contestaba. */
const MAX_PASSES = 2

const STOP_WORDS = new Set(["STOP", "BAJA", "CANCELAR", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "ALTO"])

type BrandBotConfig = {
  mode: "off" | "shadow" | "allowlist" | "on"
  allowlist: string[]
}

type Conversation = {
  id: string
  lead_id: string | null
  turns: number
  collected: Record<string, unknown>
  call_state: string
}

/** Lee el interruptor de la marca. Ante cualquier duda, apagado. */
async function brandBotConfig(sb: AnyClient, brandId: string): Promise<BrandBotConfig> {
  const { data } = await sb
    .from("brands")
    .select("whatsapp_bot_mode, whatsapp_bot_allowlist")
    .eq("id", brandId)
    .maybeSingle()
  const row = data as { whatsapp_bot_mode?: string; whatsapp_bot_allowlist?: string[] } | null
  const mode = (row?.whatsapp_bot_mode ?? "off") as BrandBotConfig["mode"]
  return { mode, allowlist: row?.whatsapp_bot_allowlist ?? [] }
}

/**
 * Crea (o encuentra) el paciente y REENGANCHA sus mensajes huérfanos.
 *
 * El reenganche no es cosmético: la ventana de 24h de Meta se mide con el último
 * entrante DEL LEAD (`lastInboundAt`), y el mensaje de quien todavía no era
 * paciente se guardó con `lead_id = null`. Sin reenganchar, la ventana leería
 * "cerrada" y el bot no podría contestar ni el primer mensaje.
 */
async function ensureLead(
  sb: AnyClient,
  args: { brandId: string; phone: string; name?: string; adRef?: unknown },
): Promise<string | null> {
  const { data: existing } = await sb
    .from("leads")
    .select("id")
    .eq("brand_id", args.brandId)
    .or(`phone.eq.${args.phone},phone_alt.eq.${args.phone}`)
    .limit(1)
  let leadId: string | null = ((existing ?? []) as { id: string }[])[0]?.id ?? null

  if (!leadId) {
    const { data, error } = await sb
      .from("leads")
      .insert({
        brand_id: args.brandId,
        // Sin nombre todavía: se usa el teléfono, igual que hace el bot de voz.
        first_name: args.name?.trim() || args.phone,
        phone: args.phone,
        status: "new",
        source: "whatsapp",
        ...(args.adRef ? { ad_ref: args.adRef } : {}),
      })
      .select("id")
      .single()
    if (error) {
      // Carrera con otra invocación: el índice único (brand_id, phone) ganó.
      if (error.code === "23505" || error.message?.includes("duplicate")) {
        const { data: again } = await sb
          .from("leads").select("id").eq("brand_id", args.brandId).eq("phone", args.phone).maybeSingle()
        leadId = (again as { id: string } | null)?.id ?? null
      } else {
        console.error("[bot] crear lead:", error.message)
        return null
      }
    } else {
      leadId = (data as { id: string }).id
    }
  }
  if (!leadId) return null

  // Reenganche en dos pasadas acotadas: los de ESTA marca y los que no tienen
  // marca. Nunca "todo huérfano con este número": un teléfono que le escribió a
  // dos clínicas arrastraría los mensajes de la otra.
  for (const scope of ["brand", "orphan"] as const) {
    let q = sb
      .from("messages")
      .update({ lead_id: leadId })
      .is("lead_id", null)
      .or(`from_number.eq.${args.phone},to_number.eq.${args.phone}`)
    q = scope === "brand" ? q.eq("brand_id", args.brandId) : q.is("brand_id", null)
    const { error } = await q.select("id")
    if (error) console.error("[bot] reenganche:", error.message)
  }
  // Los que no tenían marca ya son de esta.
  await sb
    .from("messages")
    .update({ brand_id: args.brandId })
    .eq("lead_id", leadId)
    .is("brand_id", null)

  return leadId
}

/** Historial de la conversación, tal como lo ve el modelo. */
async function loadHistory(sb: AnyClient, leadId: string): Promise<BotTurn[]> {
  const { data } = await sb
    .from("messages")
    .select("direction, body, created_at")
    .eq("lead_id", leadId)
    .eq("channel", "whatsapp")
    .order("created_at", { ascending: true })
    .limit(24)
  return ((data ?? []) as { direction: "in" | "out"; body: string | null }[])
    .filter((m) => (m.body ?? "").trim().length > 0)
    .map((m) => ({ role: m.direction === "in" ? "user" : "assistant", content: m.body as string }))
}

/** Marca opt-out del canal. Se re-evalúa aquí porque el webhook no pudo: cuando
 *  llegó el STOP todavía no existía el lead al que aplicárselo. */
async function applyStopIfNeeded(
  sb: AnyClient,
  leadId: string,
  bodies: string[],
): Promise<boolean> {
  const hit = bodies.some((b) => STOP_WORDS.has(b.trim().toUpperCase()))
  if (!hit) return false
  await sb
    .from("leads")
    .update({ wa_opt_out: true, wa_opt_out_at: new Date().toISOString() })
    .eq("id", leadId)
  // Un STOP también cancela cualquier permiso que hubiera dado antes.
  await sb
    .from("call_consents")
    .update({ revoked_at: new Date().toISOString() })
    .eq("lead_id", leadId)
    .is("revoked_at", null)
  return true
}

export type BotInbound = {
  wamid: string
  fromE164: string | null
  /** phone_number_id de Meta: de aquí sale la marca. */
  receiverId: string | null
  adRef?: unknown
}

/**
 * Punto de entrada. Se llama desde `after()` del webhook: no bloquea el ACK a
 * Meta. Nunca lanza — un bot roto no puede tumbar la recepción de mensajes.
 */
export async function handleInboundForBot(inbound: BotInbound): Promise<void> {
  try {
    if (!inbound.fromE164 || !inbound.receiverId) return
    const sb = createAdminClient() as AnyClient

    // 1. Marca SIEMPRE por el número que recibió, nunca por el lead.
    const brandId = await resolveBrandByWhatsAppPhoneId(inbound.receiverId)
    if (!brandId) return // fail-closed: número no reclamado por ninguna marca.

    // 2. Interruptor por marca, leído en cada mensaje.
    const cfg = await brandBotConfig(sb, brandId)
    if (cfg.mode === "off") return
    const phone = normalizeToE164(inbound.fromE164) || inbound.fromE164
    if (cfg.mode === "allowlist" && !cfg.allowlist.includes(phone)) return

    // 3. Candado ANTES del claim, para que un solo proceso se lleve la ráfaga.
    const conv = await acquireConversation(sb, brandId, phone)
    if (!conv) return // otro lo está atendiendo; él se llevará nuestro mensaje.

    try {
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        const handled = await processPending(sb, {
          brandId,
          phone,
          shadow: cfg.mode === "shadow",
          adRef: inbound.adRef,
        })
        if (!handled) break
      }
    } finally {
      await sb
        .from("whatsapp_bot_conversations")
        .update({ lock_until: null, updated_at: new Date().toISOString() })
        .eq("id", conv.id)
    }
  } catch (e) {
    console.error("[bot] threw:", e instanceof Error ? e.message : String(e))
  }
}

/** Toma el candado de la conversación (creándola si hace falta). null = ocupada. */
async function acquireConversation(
  sb: AnyClient,
  brandId: string,
  phone: string,
): Promise<Conversation | null> {
  await sb
    .from("whatsapp_bot_conversations")
    .upsert({ brand_id: brandId, phone_e164: phone }, { onConflict: "brand_id,phone_e164" })

  const until = new Date(Date.now() + LOCK_MS).toISOString()
  const now = new Date().toISOString()
  const { data } = await sb
    .from("whatsapp_bot_conversations")
    .update({ lock_until: until, updated_at: now })
    .eq("brand_id", brandId)
    .eq("phone_e164", phone)
    .or(`lock_until.is.null,lock_until.lt.${now}`)
    .select("id, lead_id, turns, collected, call_state")
  return ((data ?? []) as Conversation[])[0] ?? null
}

/**
 * Una vuelta completa: toma los entrantes sin contestar, corre el modelo, aplica
 * sus herramientas y manda la respuesta. Devuelve true si hubo trabajo.
 */
async function processPending(
  sb: AnyClient,
  ctx: { brandId: string; phone: string; shadow: boolean; adRef?: unknown },
): Promise<boolean> {
  // Claim de TODOS los entrantes sin atender de este teléfono. Atómico: si otro
  // proceso ya los tomó, este se queda sin filas y no hace nada.
  const { data: claimedRaw } = await sb
    .from("messages")
    .update({ bot_state: "claimed", bot_claimed_at: new Date().toISOString() })
    .eq("provider", "whatsapp")
    .eq("channel", "whatsapp")
    .eq("direction", "in")
    .eq("from_number", ctx.phone)
    .is("bot_state", null)
    .select("id, body, external_id")
  const claimed = (claimedRaw ?? []) as { id: string; body: string | null; external_id: string }[]
  if (claimed.length === 0) return false

  const bodies = claimed.map((m) => (m.body ?? "").trim()).filter(Boolean)
  const lastWamid = claimed[claimed.length - 1]?.external_id ?? null

  // Estado de la conversación.
  const { data: convRaw } = await sb
    .from("whatsapp_bot_conversations")
    .select("id, lead_id, turns, collected, call_state")
    .eq("brand_id", ctx.brandId)
    .eq("phone_e164", ctx.phone)
    .maybeSingle()
  const conv = convRaw as Conversation | null
  if (!conv) return false

  // El paciente (creándolo si es la primera vez) y su historial reenganchado.
  const leadId =
    conv.lead_id ??
    (await ensureLead(sb, { brandId: ctx.brandId, phone: ctx.phone, adRef: ctx.adRef }))
  if (!leadId) return false
  if (!conv.lead_id) {
    await sb.from("whatsapp_bot_conversations").update({ lead_id: leadId }).eq("id", conv.id)
  }

  // Re-atribuir los mensajes que acabamos de tomar a ESTA marca y a ESTE lead.
  //
  // Hace falta porque `storeInbound` prefiere la marca del lead encontrado por
  // teléfono sobre la del número que recibió: si alguien ya es paciente de otra
  // clínica y le escribe al número de anuncios de esta, su mensaje se guardó
  // bajo la marca ajena. El número que RECIBIÓ manda. Sin esto, además, la
  // ventana de 24h de este lead leería "cerrada" y el bot no podría contestar.
  await sb
    .from("messages")
    .update({ brand_id: ctx.brandId, lead_id: leadId })
    .in("id", claimed.map((m) => m.id))

  // STOP: se atiende aquí porque el webhook no tenía lead al cual aplicárselo.
  if (await applyStopIfNeeded(sb, leadId, bodies)) return false

  if (conv.turns >= MAX_TURNS) {
    console.warn(`[bot] techo de turnos alcanzado en ${ctx.phone}`)
    return false
  }

  const collected = (conv.collected ?? {}) as Record<string, unknown>
  const awaitingConsent = collected.awaiting_consent === true

  const history = await loadHistory(sb, leadId)
  if (history.length === 0) return false

  const decision = await runBotTurn({ history, collected, awaitingConsent })

  // ── Aplicar las herramientas ──────────────────────────────────────────────
  let nextCollected: Record<string, unknown> = { ...collected }
  let consentPromptSent = false

  for (const tool of decision.tools) {
    if (tool.name === "guardar_datos_del_lead") {
      const i = tool.input
      nextCollected = {
        ...nextCollected,
        ...(i.nombre ? { nombre: i.nombre } : {}),
        ...(i.necesidad ? { necesidad: i.necesidad } : {}),
        ...(i.horario_pref ? { horario_pref: i.horario_pref } : {}),
        ...(i.telefono_para_llamar
          ? { telefono_para_llamar: normalizeToE164(i.telefono_para_llamar) || i.telefono_para_llamar }
          : {}),
      }
      const patch: Record<string, unknown> = {}
      if (i.nombre) patch.first_name = i.nombre.trim().slice(0, 80)
      if (i.necesidad) patch.notes = i.necesidad.slice(0, 500)
      if (i.horario_pref) patch.callback_pref = i.horario_pref.slice(0, 120)
      if (Object.keys(patch).length > 0) await sb.from("leads").update(patch).eq("id", leadId)
    }

    if (tool.name === "pedir_permiso_para_llamar" && !awaitingConsent) {
      // El texto lo manda el SERVIDOR, no el modelo.
      const target = (nextCollected.telefono_para_llamar as string) || ctx.phone
      const prompt = CONSENT_PROMPT.replace("{{telefono}}", target)
      const r = await sendChannelMessageAsSystem({
        channel: "whatsapp",
        leadId,
        brandId: ctx.brandId,
        body: prompt,
        shadow: ctx.shadow,
      })
      if (r.ok) {
        // El wamid de la PREGUNTA: sin él, la bitácora es texto que cualquiera
        // pudo escribir después.
        const { data: sentRow } = await sb
          .from("messages")
          .select("external_id")
          .eq("lead_id", leadId).eq("direction", "out").eq("channel", "whatsapp")
          .order("created_at", { ascending: false }).limit(1).maybeSingle()
        nextCollected = {
          ...nextCollected,
          awaiting_consent: true,
          consent_prompt_text: prompt,
          consent_prompt_wamid: (sentRow as { external_id: string | null } | null)?.external_id ?? null,
          consent_target_phone: target,
        }
        consentPromptSent = true
      }
    }

    if (tool.name === "registrar_respuesta_de_permiso" && awaitingConsent) {
      if (tool.input.acepta) {
        await registerConsentAndCall(sb, {
          brandId: ctx.brandId,
          leadId,
          collected: nextCollected,
          responseText: bodies.join("\n"),
          responseWamid: lastWamid,
          shadow: ctx.shadow,
        })
      }
      nextCollected = { ...nextCollected, awaiting_consent: false, consent_answer: tool.input.acepta }
    }
  }

  // ── Mandar la respuesta redactada por el modelo ───────────────────────────
  // Si acabamos de mandar el texto legal del permiso, NO se manda nada más: el
  // modelo no debe poder envolver ni suavizar esa pregunta.
  if (decision.reply && !consentPromptSent) {
    await sendChannelMessageAsSystem({
      channel: "whatsapp",
      leadId,
      brandId: ctx.brandId,
      body: decision.reply,
      shadow: ctx.shadow,
    })
  }

  await sb
    .from("whatsapp_bot_conversations")
    .update({
      turns: conv.turns + 1,
      collected: nextCollected,
      last_wamid: lastWamid,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conv.id)

  await sb.from("messages").update({ bot_state: "answered" }).in("id", claimed.map((m) => m.id))
  return true
}

/**
 * Guarda el consentimiento y dispara la llamada.
 *
 * El texto de la pregunta y el de la respuesta salen del SERVIDOR (uno es la
 * constante, el otro es el cuerpo crudo del mensaje del paciente). El modelo
 * solo dijo "aceptó"; no redacta la evidencia.
 */
async function registerConsentAndCall(
  sb: AnyClient,
  args: {
    brandId: string
    leadId: string
    collected: Record<string, unknown>
    responseText: string
    responseWamid: string | null
    shadow: boolean
  },
): Promise<void> {
  const phone = (args.collected.consent_target_phone as string) ?? null
  const promptText = (args.collected.consent_prompt_text as string) ?? null
  if (!phone || !promptText) {
    console.error("[bot] consentimiento sin pregunta guardada: no se llama")
    return
  }

  const { data, error } = await sb
    .from("call_consents")
    .insert({
      brand_id: args.brandId,
      lead_id: args.leadId,
      phone_e164: phone,
      channel: "whatsapp",
      prompt_text: promptText,
      prompt_wamid: (args.collected.consent_prompt_wamid as string) ?? null,
      response_text: args.responseText,
      response_wamid: args.responseWamid,
    })
    .select("id")
    .single()
  if (error || !data) {
    console.error("[bot] guardar consentimiento:", error?.message)
    return
  }
  const consentId = (data as { id: string }).id

  // En shadow no se llama a nadie: el consentimiento queda guardado para poder
  // revisar que la conversación llegó hasta aquí, pero nadie recibe una llamada.
  if (args.shadow) {
    console.info(`[bot] shadow: se habría llamado a ${phone} (consent ${consentId})`)
    return
  }

  // Segundo claim atómico: Retell no tiene idempotency key, así que sin esto dos
  // ejecuciones en carrera le marcan DOS VECES al paciente.
  const { data: claimRows } = await sb
    .from("whatsapp_bot_conversations")
    .update({ call_state: "dispatching" })
    .eq("brand_id", args.brandId)
    .eq("phone_e164", (args.collected.phone_e164 as string) ?? phone)
    .in("call_state", ["none", "consented"])
    .select("id")
  if (((claimRows ?? []) as unknown[]).length === 0) {
    // Ya hay una llamada en curso o hecha para esta conversación.
    return
  }

  if (!isWithinCallingHours()) {
    // Fuera de horario no se llama: queda el permiso guardado y la preferencia
    // en la ficha para que un humano marque. (Las llamadas diferidas quedaron
    // fuera de la Fase 1: los crons frecuentes dependen de un servicio externo.)
    await sb
      .from("whatsapp_bot_conversations")
      .update({ call_state: "consented" })
      .eq("brand_id", args.brandId)
      .eq("phone_e164", phone)
    return
  }

  const r = await dispatchOutboundCallForBot({
    leadId: args.leadId,
    brandId: args.brandId,
    consentId,
  })
  await sb
    .from("whatsapp_bot_conversations")
    .update({
      call_state: r.ok ? "dispatched" : "failed",
      ...(r.ok ? { retell_call_id: r.retellCallId } : {}),
    })
    .eq("brand_id", args.brandId)
    .eq("phone_e164", phone)
}
