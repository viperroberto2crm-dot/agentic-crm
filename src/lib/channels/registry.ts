import "server-only"
import { twilioSmsAdapter } from "./adapters/twilio-sms"
import { whatsappCloudAdapter } from "./adapters/whatsapp-cloud"
import type { ChannelAdapter, ChannelKey } from "./types"

/**
 * Registro de canales. Esta es la lista, y no hay otra.
 *
 * Para agregar Instagram DM / Messenger / Email:
 *   1. escribir `adapters/<canal>.ts` que cumpla `ChannelAdapter`,
 *   2. agregarlo aquí y a `ChannelKey` en types.ts.
 *
 * Con eso quedan gratis: el webhook (`/api/webhooks/<canal>`), la bandeja, el
 * envío desde la ficha y el registro en `messages`.
 */
export const CHANNELS: Record<ChannelKey, ChannelAdapter> = {
  sms: twilioSmsAdapter,
  whatsapp: whatsappCloudAdapter,
}

export const CHANNEL_KEYS = Object.keys(CHANNELS) as ChannelKey[]

export function getAdapter(key: string): ChannelAdapter | null {
  return (CHANNELS as Record<string, ChannelAdapter | undefined>)[key] ?? null
}

/**
 * El slug de la URL del webhook no siempre es el nombre del canal: las rutas
 * `/api/webhooks/twilio` y `/api/webhooks/whatsapp` YA están registradas con
 * Twilio y con Meta, y cambiarlas tiraría los canales en vivo.
 */
const WEBHOOK_ALIASES: Record<string, ChannelKey> = {
  twilio: "sms",
  sms: "sms",
  whatsapp: "whatsapp",
}

export function getAdapterByWebhookSlug(slug: string): ChannelAdapter | null {
  const key = WEBHOOK_ALIASES[slug.toLowerCase()]
  return key ? CHANNELS[key] : null
}
