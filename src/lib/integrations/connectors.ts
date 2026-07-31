import type { IntegrationKey } from "./health"

/**
 * Registro de conectores: qué credenciales pide cada servicio para "Conectar"
 * desde la UI. Es SOLO metadata (nombres/labels/env de fallback) — jamás valores.
 * Fuente única para: el formulario de conectar, el resolver y el estado.
 */

export type ConnectorField = {
  /** clave interna (columna dentro del jsonb `secrets`). */
  key: string
  /** etiqueta visible en el formulario. */
  label: string
  /** variable de entorno de fallback (lo que se usa hoy). */
  env: string
  /** si true, se muestra como campo tipo password y se enmascara. */
  masked: boolean
}

export type Connector = {
  provider: IntegrationKey
  /** true = tiene formulario "Conectar" en el hub. */
  connectable: boolean
  fields: ConnectorField[]
}

export const CONNECTORS: Partial<Record<IntegrationKey, Connector>> = {
  stripe: {
    provider: "stripe",
    connectable: true,
    fields: [
      { key: "secret_key", label: "Secret key (sk_…)", env: "STRIPE_SECRET_KEY", masked: true },
      { key: "webhook_secret", label: "Webhook secret (whsec_…)", env: "STRIPE_WEBHOOK_SECRET", masked: true },
    ],
  },
  square: {
    provider: "square",
    connectable: true,
    fields: [
      { key: "access_token", label: "Access token", env: "SQUARE_ACCESS_TOKEN", masked: true },
      { key: "webhook_signature_key", label: "Webhook signature key", env: "SQUARE_WEBHOOK_SIGNATURE_KEY", masked: true },
    ],
  },
  meta: {
    provider: "meta",
    connectable: true,
    fields: [
      { key: "page_access_token", label: "Page access token", env: "META_PAGE_ACCESS_TOKEN", masked: true },
    ],
  },
  eighthundred: {
    provider: "eighthundred",
    connectable: true,
    fields: [
      { key: "api_key", label: "API key", env: "EIGHTHUNDRED_API_KEY", masked: true },
      { key: "company_id", label: "Company ID", env: "EIGHTHUNDRED_COMPANY_ID", masked: false },
      { key: "webhook_secret", label: "Webhook secret", env: "EIGHTHUNDRED_WEBHOOK_SECRET", masked: true },
    ],
  },
  practicebetter: {
    provider: "practicebetter",
    connectable: true,
    fields: [
      { key: "client_id", label: "Client ID", env: "PRACTICE_BETTER_CLIENT_ID", masked: false },
      { key: "client_secret", label: "Client secret", env: "PRACTICE_BETTER_CLIENT_SECRET", masked: true },
    ],
  },
  twilio: {
    provider: "twilio",
    connectable: true,
    fields: [
      { key: "account_sid", label: "Account SID", env: "TWILIO_ACCOUNT_SID", masked: false },
      { key: "auth_token", label: "Auth token", env: "TWILIO_AUTH_TOKEN", masked: true },
      { key: "from_number", label: "Número de envío (From, ej. +1310…)", env: "TWILIO_FROM_NUMBER", masked: false },
    ],
  },
}

/** Providers que tienen formulario de conexión, en orden. */
export const CONNECTABLE_KEYS = Object.keys(CONNECTORS) as IntegrationKey[]
