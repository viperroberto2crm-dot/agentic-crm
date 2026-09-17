import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Alertas al equipo: un correo cuando pasa algo que hay que atender ya.
 *
 * Por qué correo y no SMS: la campaña A2P 10DLC de Twilio está rechazada y los
 * carriers bloquean el tráfico 10DLC sin registrar. `alert_recipients.channel`
 * existe desde el día uno para que prender SMS después sea un cambio de valor.
 *
 * Reglas duras de este archivo:
 *  - NUNCA lanza. Si algo falla, se registra y la operación del CRM sigue.
 *  - NUNCA tarda: corta a 2.5 s. El bot de voz no puede quedarse esperando a
 *    Resend a media llamada.
 *  - NUNCA manda dos veces lo mismo: `alert_log(recipient_id, dedupe_key)` es
 *    único, así que el reintento de una herramienta no genera un segundo correo.
 *  - Contenido mínimo (nombre, día y hora). Sin servicio ni motivo: esto viaja
 *    por correo y son datos de pacientes.
 */

export type CrmAlertEvent =
  | "appointment_set"
  | "appointment_cancelled"
  | "sale_paid"
  | "new_lead"

/** Tope por destinatario por hora. Protege de una importación o un bucle. */
const MAX_PER_HOUR = 20
const SEND_TIMEOUT_MS = 2500

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

type Recipient = {
  id: string
  label: string
  channel: string
  email: string | null
  phone: string | null
  brand_ids: string[] | null
  events: string[] | null
}

/** Manda el correo por la API de Resend (sin SDK: es un POST). */
export async function sendAlertEmail(input: {
  to: string
  subject: string
  text: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: "Falta RESEND_API_KEY" }
  const domain = process.env.RESEND_EMAIL_DOMAIN
  if (!domain) return { ok: false, error: "Falta RESEND_EMAIL_DOMAIN" }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS)
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Alertas CRM <alertas@${domain}>`,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return { ok: false, error: `resend ${res.status}: ${body.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg === "This operation was aborted" ? "timeout (2.5s)" : msg }
  } finally {
    clearTimeout(timer)
  }
}

/** Nombre de la marca para el asunto. Si no se puede, se omite. */
async function brandName(sb: Admin, brandId?: string | null): Promise<string | null> {
  if (!brandId) return null
  const { data } = await sb.from("brands").select("name").eq("id", brandId).maybeSingle()
  return (data as { name: string } | null)?.name ?? null
}

/**
 * Dispara la alerta. `dedupeKey` debe identificar el hecho, no el intento:
 * el id de la cita, el id del pago externo, el id del lead.
 */
export async function emitCrmEvent(input: {
  event: CrmAlertEvent
  brandId?: string | null
  dedupeKey: string
  subject: string
  body: string
}): Promise<void> {
  try {
    const sb = createAdminClient() as unknown as Admin

    const { data: raw } = await sb
      .from("alert_recipients")
      .select("id, label, channel, email, phone, brand_ids, events")
      .eq("active", true)
      .contains("events", [input.event])
    const all = (raw ?? []) as Recipient[]
    if (all.length === 0) return

    // brand_ids vacío = todas las marcas.
    const recipients = all.filter((r) => {
      const ids = r.brand_ids ?? []
      if (ids.length === 0) return true
      return !!input.brandId && ids.includes(input.brandId)
    })
    if (recipients.length === 0) return

    const marca = await brandName(sb, input.brandId)
    const subject = marca ? `${input.subject} · ${marca}` : input.subject
    const text = marca ? `${input.body}\n\nMarca: ${marca}` : input.body

    for (const r of recipients) {
      const destination = r.channel === "email" ? r.email : r.phone
      if (!destination) continue

      // 1) Reservar. El índice único hace el dedupe: si ya existe, no se manda.
      const { data: reserved, error: reserveErr } = await sb
        .from("alert_log")
        .insert({
          recipient_id: r.id,
          event: input.event,
          dedupe_key: input.dedupeKey,
          channel: r.channel,
          destination,
          status: "sending",
        })
        .select("id")
        .single()
      if (reserveErr || !reserved) continue // duplicado (23505) o error: no insistir
      const logId = (reserved as { id: string }).id

      // 2) Tope por hora, ya con la reserva hecha para no repetir el conteo.
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { count } = await sb
        .from("alert_log")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", r.id)
        .eq("status", "sent")
        .gte("created_at", hourAgo)
      if ((count ?? 0) >= MAX_PER_HOUR) {
        await sb
          .from("alert_log")
          .update({ status: "skipped", error: `tope de ${MAX_PER_HOUR}/hora` })
          .eq("id", logId)
        continue
      }

      // 3) Mandar. Hoy solo correo; SMS/WhatsApp quedan marcados como omitidos.
      if (r.channel !== "email") {
        await sb
          .from("alert_log")
          .update({ status: "skipped", error: `canal '${r.channel}' todavía no está activo` })
          .eq("id", logId)
        continue
      }
      const sent = await sendAlertEmail({ to: destination, subject, text })
      await sb
        .from("alert_log")
        .update(
          sent.ok
            ? { status: "sent", error: null }
            : { status: "failed", error: sent.error.slice(0, 500) },
        )
        .eq("id", logId)
    }
  } catch {
    // Silencio a propósito: una alerta nunca debe tumbar una cita ni un pago.
  }
}

/**
 * Aviso de pago. El `dedupeKey` es el id del pago en Stripe/Square, así que
 * aunque Square mande `payment.created` y varios `payment.updated` del MISMO
 * cobro, el correo sale una sola vez.
 */
export async function emitSalePaid(input: {
  provider: "stripe" | "square"
  externalId: string
  brandId?: string | null
  amountCents?: number | null
  currency?: string | null
  customerName?: string | null
}): Promise<void> {
  const monto =
    typeof input.amountCents === "number" && input.amountCents > 0
      ? `$${(input.amountCents / 100).toFixed(2)} ${(input.currency ?? "usd").toUpperCase()}`
      : "monto no disponible"
  await emitCrmEvent({
    event: "sale_paid",
    brandId: input.brandId,
    dedupeKey: `pay:${input.provider}:${input.externalId}`,
    subject: "Pago recibido",
    body: [
      `${input.customerName?.trim() || "Paciente"} · ${monto}`,
      `Cobrado por ${input.provider === "stripe" ? "Stripe" : "Square"}.`,
    ].join("\n"),
  })
}

/** Formatea fecha/hora en California, que es donde están las clínicas. */
export function pacificStamp(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso))
}
