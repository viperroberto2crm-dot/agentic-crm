import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets"
import { CONNECTORS } from "./connectors"
import type { IntegrationKey } from "./health"

/**
 * Lectura/escritura de credenciales guardadas (cifradas) en connection_credentials.
 * SIEMPRE con el admin client (service-role): la tabla NO tiene policy de SELECT
 * para `authenticated`, así que ningún usuario de sesión puede leer los secretos.
 * Todo server-only; los valores en claro jamás cruzan al cliente.
 *
 * Fila por provider: { provider, secrets: { <fieldKey>: <blob cifrado> } }.
 */

type Row = { provider: string; secrets: Record<string, string> | null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createAdminClient() as unknown
}

async function getRow(provider: IntegrationKey): Promise<Row | null> {
  const { data } = await db()
    .from("connection_credentials")
    .select("provider, secrets")
    .eq("provider", provider)
    .maybeSingle()
  return (data as Row | null) ?? null
}

/**
 * Devuelve el valor de una credencial: primero la guardada (descifrada) y, si no
 * existe en la base, cae a la variable de entorno de fallback. null si ninguna.
 */
export async function getConnectionSecret(
  provider: IntegrationKey,
  fieldKey: string,
): Promise<string | null> {
  const field = CONNECTORS[provider]?.fields.find((f) => f.key === fieldKey)
  const envName = field?.env
  try {
    const row = await getRow(provider)
    const blob = row?.secrets?.[fieldKey]
    if (blob) {
      try {
        return decryptSecret(blob, `${provider}:${fieldKey}`)
      } catch {
        // Blob corrupto / llave cambiada / AAD no coincide → cae a env, no rompe.
      }
    }
  } catch {
    // Error de DB → cae a env.
  }
  return envName ? process.env[envName] ?? null : null
}

/** Qué campos están guardados EN LA BASE (cifrados) para este provider. */
export async function getStoredFieldKeys(provider: IntegrationKey): Promise<string[]> {
  try {
    const row = await getRow(provider)
    return row?.secrets ? Object.keys(row.secrets) : []
  } catch {
    return []
  }
}

/** Mapa provider → set de campos guardados en la base (una sola query). */
export async function getAllStoredFieldKeys(): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  try {
    const { data } = await db()
      .from("connection_credentials")
      .select("provider, secrets")
    for (const r of (data ?? []) as Row[]) {
      out.set(r.provider, new Set(Object.keys(r.secrets ?? {})))
    }
  } catch {
    // sin tabla / sin acceso → mapa vacío (todo cae a env).
  }
  return out
}

/**
 * Guarda/actualiza credenciales cifradas. Solo cifra los campos con valor no
 * vacío (permite actualizar unos sin borrar otros). Devuelve ok/error.
 */
export async function saveConnection(
  provider: IntegrationKey,
  values: Record<string, string>,
  createdBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const connector = CONNECTORS[provider]
  if (!connector) return { ok: false, error: "Servicio no conectable" }

  try {
    const row = await getRow(provider)
    const secrets: Record<string, string> = { ...(row?.secrets ?? {}) }
    for (const field of connector.fields) {
      const v = values[field.key]?.trim()
      // AAD = provider:field → el blob solo sirve en su slot (Fable #1).
      if (v) secrets[field.key] = encryptSecret(v, `${provider}:${field.key}`)
    }
    const now = new Date().toISOString()
    // Insert vs update explícito: preserva created_by original y registra
    // updated_by (rastro de auditoría, Fable #3).
    const { error } = row
      ? await db().from("connection_credentials")
          .update({ secrets, updated_by: createdBy, updated_at: now })
          .eq("provider", provider)
      : await db().from("connection_credentials")
          .insert({ provider, secrets, created_by: createdBy, updated_by: createdBy })
    if (error) {
      console.error("[connections] save:", error.message)
      return { ok: false, error: "No se pudo guardar la conexión." }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[connections] save threw:", msg)
    // No filtrar el mensaje crudo (podría mencionar la llave). Mensaje genérico.
    return { ok: false, error: "No se pudo cifrar/guardar la conexión (¿llave maestra configurada?)." }
  }
}

/** Borra las credenciales guardadas de un provider (vuelve a usar env si existe). */
export async function clearConnection(
  provider: IntegrationKey,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await db().from("connection_credentials").delete().eq("provider", provider)
    if (error) return { ok: false, error: "No se pudo borrar la conexión." }
    return { ok: true }
  } catch {
    return { ok: false, error: "No se pudo borrar la conexión." }
  }
}
