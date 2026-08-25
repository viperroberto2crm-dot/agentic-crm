import "server-only"
import type { IntegrationKey } from "@/lib/integrations/health"

/**
 * Contrato de un CANAL de mensajería.
 *
 * La idea del Centro de Canales: todo lo que es igual entre canales (buscar el
 * lead por teléfono, atribuir la marca, respetar el opt-out, guardar en
 * `messages`, idempotencia) vive UNA vez en `webhook.ts` y `send.ts`. Lo único
 * que cambia por canal — cómo firma el proveedor, cómo viene su JSON, cómo se
 * manda — vive en su adaptador.
 *
 * Agregar Instagram DM o Messenger = escribir un archivo en `adapters/` y
 * registrarlo. Ni ruta nueva, ni pantalla nueva, ni acción nueva.
 */

export type ChannelKey = "sms" | "whatsapp"

/** Un mensaje entrante, ya normalizado (cada adaptador traduce su formato a esto). */
export type InboundMessage = {
  /** ID del proveedor (MessageSid, wamid…). Es la llave de idempotencia. */
  externalId: string
  /** Lo que se GUARDA en `from_number` (cada proveedor tiene su formato). */
  from: string | null
  /**
   * El mismo remitente normalizado a E.164. Es el que se usa para buscar al
   * lead y para aplicar el opt-out — nunca el crudo.
   */
  fromE164: string | null
  /** NUESTRO identificador que lo recibió, tal como se guarda en `to_number`. */
  to: string | null
  body: string
  /** Cuándo lo mandó el paciente. Si el proveedor no lo dice, null → default de la tabla. */
  sentAt: string | null
  status: string
  raw: unknown
  /**
   * Con qué identificar la marca dueña del endpoint que recibió (número Twilio,
   * phone_number_id de Meta…). null si el proveedor no lo manda.
   */
  receiverId: string | null
}

export type StatusUpdate = {
  externalId: string
  status: string
}

export type ParsedWebhook = {
  messages: InboundMessage[]
  statuses: StatusUpdate[]
}

export type SendArgs = {
  brandId: string
  leadId: string
  /** Teléfono del paciente en E.164. */
  to: string
  body?: string
  template?: { name: string; language: string; params?: string[] }
}

export type SendOutcome =
  | {
      ok: true
      externalId: string
      /** Lo que se guarda en el hilo (para plantillas, el texto ya resuelto). */
      threadBody: string
      /** Lo que se guarda en `from_number` (número Twilio o phone_number_id). */
      from: string
    }
  | { ok: false; error: string }

export type ChannelAdapter = {
  key: ChannelKey
  /** Valor de la columna `provider` en `messages`. */
  provider: string
  /** De qué integración saca sus credenciales (Configuración → Integraciones). */
  integration: IntegrationKey

  /** Columnas de consentimiento en `leads`. Cada canal tiene el suyo. */
  optOut: { column: string; atColumn: string }
  stopWords: Set<string>
  startWords: Set<string>

  /**
   * Handshake de verificación del webhook (Meta lo exige; Twilio no). Devuelve
   * la respuesta a mandar, o null si este canal no usa handshake.
   */
  verifyChallenge?: (url: URL) => Promise<Response | null>

  /**
   * ¿La petición viene de verdad del proveedor? Fail-closed siempre.
   *
   * `configured` se distingue de `ok` a propósito: "no hay credencial" (503) y
   * "la firma no cuadra" (403) son problemas distintos, y mezclarlos hace
   * imposible depurar un webhook que no entra.
   */
  verifySignature: (args: {
    rawBody: string
    headers: Headers
    /** URL exacta que el proveedor firmó (Twilio firma la URL; Meta no). */
    webhookUrl: string
  }) => Promise<{ configured: boolean; ok: boolean }>

  /** Traduce el cuerpo crudo del proveedor a la forma normalizada. */
  parse: (rawBody: string) => ParsedWebhook

  /** Qué contestarle al proveedor cuando todo salió bien (Twilio quiere TwiML). */
  ack: () => Response

  /** Marca dueña del endpoint que recibió el mensaje. */
  resolveBrand: (receiverId: string | null) => Promise<string | null>

  /** Manda el mensaje. Aquí vive TODO lo específico del proveedor. */
  send: (args: SendArgs) => Promise<SendOutcome>

  /**
   * Reglas que el servidor tiene que hacer cumplir antes de mandar. WhatsApp
   * tiene la ventana de 24h de Meta; SMS no tiene equivalente.
   */
  checkSendPolicy?: (args: SendArgs) => Promise<{ ok: true } | { ok: false; error: string }>
}
