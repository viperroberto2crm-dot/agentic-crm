import "server-only"

/**
 * Estado de las integraciones para el hub de Configuración → Integraciones.
 *
 * Dos niveles:
 *  - getIntegrationStatuses(): rápido, SOLO mira si la config (env) está presente.
 *    Corre en el server (página de settings, admin). No hace llamadas externas y
 *    NUNCA devuelve el valor de un secreto — solo si existe.
 *  - testIntegration(key): bajo demanda (botón "Probar"), hace UNA llamada en vivo
 *    con timeout para confirmar que la credencial de verdad funciona.
 *
 * Todo es server-only: los secretos jamás cruzan al cliente.
 */

export type IntegrationKey =
  | "stripe"
  | "square"
  | "meta"
  | "eighthundred"
  | "practicebetter"
  | "whatsapp"
  | "hermes_vps"

export type IntegrationStatus = "connected" | "partial" | "none" | "soon"

export type IntegrationHealth = {
  status: IntegrationStatus
  /** Pista corta NO secreta (ej. "Falta STRIPE_WEBHOOK_SECRET"). */
  detail: string
}

const has = (v: string | undefined | null) => typeof v === "string" && v.trim().length > 0

/** Estado por presencia de config (sin llamadas externas). */
export function getIntegrationStatuses(): Record<IntegrationKey, IntegrationHealth> {
  const e = process.env

  // Stripe: llave secreta + secreto de webhook.
  const stripeKey = has(e.STRIPE_SECRET_KEY)
  const stripeHook = has(e.STRIPE_WEBHOOK_SECRET)
  const stripe: IntegrationHealth = stripeKey && stripeHook
    ? { status: "connected", detail: "Llave y webhook configurados" }
    : stripeKey || stripeHook
      ? { status: "partial", detail: stripeKey ? "Falta el secreto de webhook" : "Falta la llave secreta" }
      : { status: "none", detail: "Sin configurar" }

  // Square: access token + firma de webhook.
  const sqTok = has(e.SQUARE_ACCESS_TOKEN)
  const sqHook = has(e.SQUARE_WEBHOOK_SIGNATURE_KEY)
  const square: IntegrationHealth = sqTok && sqHook
    ? { status: "connected", detail: "Token y webhook configurados" }
    : sqTok || sqHook
      ? { status: "partial", detail: sqTok ? "Falta la firma de webhook" : "Falta el access token" }
      : { status: "none", detail: "Sin configurar" }

  // Meta / Facebook (Lead Ads): page access token.
  const meta: IntegrationHealth = has(e.META_PAGE_ACCESS_TOKEN)
    ? { status: "connected", detail: "Token de página configurado" }
    : { status: "none", detail: "Sin configurar" }

  // 800.com: api key + company id + secreto de webhook.
  const e8Key = has(e.EIGHTHUNDRED_API_KEY)
  const e8Co = has(e.EIGHTHUNDRED_COMPANY_ID)
  const e8Hook = has(e.EIGHTHUNDRED_WEBHOOK_SECRET)
  const eighthundred: IntegrationHealth = e8Key && e8Co && e8Hook
    ? { status: "connected", detail: "API y webhook configurados" }
    : e8Key || e8Co || e8Hook
      ? { status: "partial", detail: "Configuración incompleta" }
      : { status: "none", detail: "Sin configurar" }

  // Practice Better: client id + secret (OAuth2).
  const pbId = has(e.PRACTICE_BETTER_CLIENT_ID)
  const pbSec = has(e.PRACTICE_BETTER_CLIENT_SECRET)
  const practicebetter: IntegrationHealth = pbId && pbSec
    ? { status: "connected", detail: "Credenciales OAuth configuradas" }
    : pbId || pbSec
      ? { status: "partial", detail: "Credencial incompleta" }
      : { status: "none", detail: "Sin configurar" }

  // WhatsApp: aún no implementado (solo env comentadas).
  const whatsapp: IntegrationHealth = has(e.WHATSAPP_BSP_API_KEY) && has(e.WHATSAPP_BSP_PHONE_ID)
    ? { status: "partial", detail: "Credenciales presentes, envío no implementado" }
    : { status: "soon", detail: "Próximamente" }

  // Hermes del VPS: puente externo aún no construido.
  const hermes_vps: IntegrationHealth = { status: "soon", detail: "Puente al VPS pendiente" }

  return { stripe, square, meta, eighthundred, practicebetter, whatsapp, hermes_vps }
}

// ── Prueba en vivo (bajo demanda) ────────────────────────────────────────────

/**
 * Corre `fn` con un AbortSignal que se cancela a los `ms`. El timer se limpia en
 * `finally` DESPUÉS de que fn termina (incluida la lectura del body), así el
 * timeout cubre toda la operación, no solo la llegada de los headers (Fable #2).
 */
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms = 4000,
): Promise<T> {
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
        const k = process.env.STRIPE_SECRET_KEY
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
        const k = process.env.SQUARE_ACCESS_TOKEN
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
        const k = process.env.META_PAGE_ACCESS_TOKEN
        if (!k) return { ok: false, detail: "Falta el token de página" }
        // Token por header (no en la URL) para no dejarlo en logs de proxy (Fable #3).
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
        // Token POST en vivo con timeout (no reutilizamos getPbAccessToken porque
        // no tiene timeout y cachea → daría un "OK" falso, Fable #1 y #4).
        const id = process.env.PRACTICE_BETTER_CLIENT_ID
        const sec = process.env.PRACTICE_BETTER_CLIENT_SECRET
        if (!id || !sec) return { ok: false, detail: "Credenciales no configuradas" }
        const base = process.env.PRACTICE_BETTER_BASE_URL ?? "https://api.practicebetter.io"
        return await withTimeout(async (signal) => {
          const res = await fetch(`${base}/oauth2/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "client_credentials",
              client_id: id,
              client_secret: sec,
              scope: "read write",
            }).toString(),
            signal,
          })
          return res.ok
            ? { ok: true, detail: "Conexión con Practice Better OK" }
            : { ok: false, detail: `Practice Better respondió ${res.status}` }
        })
      }
      case "eighthundred": {
        const k = process.env.EIGHTHUNDRED_API_KEY
        const co = process.env.EIGHTHUNDRED_COMPANY_ID
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
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, detail: msg.slice(0, 120) }
  }
}
