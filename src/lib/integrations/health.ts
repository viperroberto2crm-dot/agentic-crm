import "server-only"
import { CONNECTORS } from "./connectors"
import { getConnectionSecret, getAllStoredFieldKeys } from "./connections"

/**
 * Estado de las integraciones para el hub de Configuración → Integraciones.
 *
 *  - getIntegrationStatuses(): estado por presencia de config. Una credencial
 *    "está" si se guardó cifrada en la base (connection_credentials) O si existe
 *    su variable de entorno de fallback. NUNCA devuelve el valor de un secreto.
 *  - testIntegration(key): bajo demanda ("Probar"), hace una llamada real con
 *    timeout usando el valor efectivo (DB o env) para confirmar que funciona.
 *
 * Todo server-only: los secretos jamás cruzan al cliente.
 */

export type IntegrationKey =
  | "stripe"
  | "square"
  | "meta"
  | "eighthundred"
  | "practicebetter"
  | "twilio"
  | "whatsapp"
  | "hermes_vps"

export type IntegrationStatus = "connected" | "partial" | "none" | "soon"

export type IntegrationHealth = {
  status: IntegrationStatus
  /** Pista corta NO secreta (ej. "Falta: Webhook secret"). */
  detail: string
}

const has = (v: string | undefined | null) => typeof v === "string" && v.trim().length > 0

/** Estado por presencia de config (DB cifrada + fallback env). Sin llamadas externas. */
export async function getIntegrationStatuses(): Promise<Record<IntegrationKey, IntegrationHealth>> {
  const stored = await getAllStoredFieldKeys()

  const present = (provider: IntegrationKey, envName: string, fieldKey: string): boolean =>
    (stored.get(provider)?.has(fieldKey) ?? false) || has(process.env[envName])

  function fromConnector(provider: IntegrationKey): IntegrationHealth {
    const c = CONNECTORS[provider]
    if (!c) return { status: "none", detail: "Sin configurar" }
    const missing = c.fields.filter((f) => !present(provider, f.env, f.key))
    if (missing.length === 0) return { status: "connected", detail: "Configurado" }
    if (missing.length < c.fields.length) {
      return { status: "partial", detail: `Falta: ${missing.map((f) => f.label).join(", ")}` }
    }
    return { status: "none", detail: "Sin configurar" }
  }

  return {
    stripe: fromConnector("stripe"),
    square: fromConnector("square"),
    meta: fromConnector("meta"),
    eighthundred: fromConnector("eighthundred"),
    practicebetter: fromConnector("practicebetter"),
    twilio: fromConnector("twilio"),
    whatsapp: fromConnector("whatsapp"),
    hermes_vps: { status: "soon", detail: "Puente al VPS pendiente" },
  }
}

// ── Prueba en vivo (bajo demanda) ────────────────────────────────────────────

/**
 * Corre `fn` con un AbortSignal que se cancela a los `ms`. El timer se limpia en
 * `finally` DESPUÉS de que fn termina (incluida la lectura del body), así el
 * timeout cubre toda la operación, no solo la llegada de los headers.
 */
async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms = 4000): Promise<T> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fn(ctrl.signal)
  } finally {
    clearTimeout(id)
  }
}

export type TestResult = { ok: boolean; detail: string }

/** Hace una llamada real (con timeout) para confirmar la credencial. Nunca lanza. */
export async function testIntegration(key: IntegrationKey): Promise<TestResult> {
  try {
    switch (key) {
      case "stripe": {
        const k = await getConnectionSecret("stripe", "secret_key")
        if (!k) return { ok: false, detail: "Falta la llave secreta" }
        return await withTimeout(async (signal) => {
          const res = await fetch("https://api.stripe.com/v1/balance", {
            headers: { Authorization: `Bearer ${k}` }, signal,
          })
          return res.ok
            ? { ok: true, detail: "Conexión con Stripe OK" }
            : { ok: false, detail: `Stripe respondió ${res.status}` }
        })
      }
      case "square": {
        const k = await getConnectionSecret("square", "access_token")
        if (!k) return { ok: false, detail: "Falta el access token" }
        const base = process.env.SQUARE_API_BASE_URL ?? "https://connect.squareup.com"
        return await withTimeout(async (signal) => {
          const res = await fetch(`${base}/v2/locations`, {
            headers: { Authorization: `Bearer ${k}`, "Square-Version": "2025-01-23" }, signal,
          })
          if (!res.ok) return { ok: false, detail: `Square respondió ${res.status}` }
          const j = (await res.json()) as { locations?: unknown[] }
          return { ok: true, detail: `Conexión con Square OK (${j.locations?.length ?? 0} ubicaciones)` }
        })
      }
      case "meta": {
        const k = await getConnectionSecret("meta", "page_access_token")
        if (!k) return { ok: false, detail: "Falta el token de página" }
        return await withTimeout(async (signal) => {
          const res = await fetch("https://graph.facebook.com/v25.0/me?fields=id,name", {
            headers: { Authorization: `Bearer ${k}` }, signal,
          })
          if (!res.ok) return { ok: false, detail: `Meta respondió ${res.status} (¿token vencido?)` }
          const j = (await res.json()) as { name?: string }
          return { ok: true, detail: `Conexión con Meta OK${j.name ? ` (${j.name})` : ""}` }
        })
      }
      case "practicebetter": {
        const id = await getConnectionSecret("practicebetter", "client_id")
        const sec = await getConnectionSecret("practicebetter", "client_secret")
        if (!id || !sec) return { ok: false, detail: "Credenciales no configuradas" }
        const base = process.env.PRACTICE_BETTER_BASE_URL ?? "https://api.practicebetter.io"
        return await withTimeout(async (signal) => {
          const res = await fetch(`${base}/oauth2/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "client_credentials", client_id: id, client_secret: sec, scope: "read write",
            }).toString(),
            signal,
          })
          return res.ok
            ? { ok: true, detail: "Conexión con Practice Better OK" }
            : { ok: false, detail: `Practice Better respondió ${res.status}` }
        })
      }
      case "twilio": {
        const sid = await getConnectionSecret("twilio", "account_sid")
        const tok = await getConnectionSecret("twilio", "auth_token")
        if (!sid || !tok) return { ok: false, detail: "Faltan SID / Auth Token" }
        return await withTimeout(async (signal) => {
          const auth = Buffer.from(`${sid}:${tok}`).toString("base64")
          const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
            headers: { Authorization: `Basic ${auth}` }, signal,
          })
          return res.ok
            ? { ok: true, detail: "Conexión con Twilio OK" }
            : { ok: false, detail: `Twilio respondió ${res.status}` }
        })
      }
      case "whatsapp": {
        const id = await getConnectionSecret("whatsapp", "phone_number_id")
        const tok = await getConnectionSecret("whatsapp", "access_token")
        if (!id || !tok) return { ok: false, detail: "Faltan Phone Number ID / access token" }
        return await withTimeout(async (signal) => {
          const v = process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v25.0"
          const res = await fetch(
            `https://graph.facebook.com/${v}/${encodeURIComponent(id)}?fields=display_phone_number,verified_name,quality_rating`,
            { headers: { Authorization: `Bearer ${tok}` }, signal },
          )
          if (!res.ok) {
            return { ok: false, detail: `WhatsApp respondió ${res.status} (¿token vencido o Phone Number ID equivocado?)` }
          }
          const j = (await res.json()) as { display_phone_number?: string; verified_name?: string }
          const who = [j.verified_name, j.display_phone_number].filter(Boolean).join(" · ")
          return { ok: true, detail: `Conexión con WhatsApp OK${who ? ` (${who})` : ""}` }
        })
      }
      case "eighthundred": {
        const k = await getConnectionSecret("eighthundred", "api_key")
        const co = await getConnectionSecret("eighthundred", "company_id")
        if (!k || !co) return { ok: false, detail: "Falta API key o company id" }
        return { ok: true, detail: "Configuración presente (usa /admin para verificar el webhook)" }
      }
      default:
        return { ok: false, detail: "Este servicio aún no se puede probar" }
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, detail: "Tiempo de espera agotado" }
    }
    // Mensaje genérico a la UI; el detalle crudo solo al log del server (evita que
    // un futuro `case` filtre una credencial dentro de un error, Fable #4).
    console.error("[health] test threw:", e instanceof Error ? e.message : String(e))
    return { ok: false, detail: "No se pudo probar la conexión" }
  }
}
