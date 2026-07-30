"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createClient } from "@/lib/supabase/server"
import { testIntegration, type IntegrationKey } from "@/lib/integrations/health"
import { CONNECTORS } from "@/lib/integrations/connectors"
import { saveConnection, clearConnection } from "@/lib/integrations/connections"
import { isEncryptionConfigured } from "@/lib/crypto/secrets"

/** Devuelve el userId si el usuario actual es admin, si no null. */
async function currentAdminId(): Promise<string | null> {
  const sb = (await createClient()) as unknown as SupabaseClient<Database>
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data } = await sb.from("users").select("role").eq("id", user.id).single()
  return data?.role === "admin" ? user.id : null
}

const KeySchema = z.enum([
  "stripe", "square", "meta", "eighthundred", "practicebetter", "twilio", "whatsapp", "hermes_vps",
])

/** Prueba en vivo la conexión de un servicio. Solo admin. Nunca expone secretos. */
export async function testIntegrationAction(
  key: string,
): Promise<{ ok: boolean; detail: string }> {
  if (!(await currentAdminId())) return { ok: false, detail: "Solo un admin puede probar conexiones." }
  const parsed = KeySchema.safeParse(key)
  if (!parsed.success) return { ok: false, detail: "Servicio inválido." }
  return testIntegration(parsed.data)
}

const SaveSchema = z.object({
  provider: KeySchema,
  // Solo campos string, tope defensivo de longitud. Se valida contra el conector.
  values: z.record(z.string().max(2000)),
})

/** Guarda credenciales cifradas de un servicio. Solo admin. */
export async function saveConnectionAction(
  raw: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await currentAdminId()
  if (!userId) return { ok: false, error: "Solo un admin puede conectar servicios." }
  if (!isEncryptionConfigured()) {
    return { ok: false, error: "Falta configurar CONNECTIONS_ENC_KEY en el servidor." }
  }
  const parsed = SaveSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: "Datos inválidos." }
  const provider = parsed.data.provider as IntegrationKey
  const connector = CONNECTORS[provider]
  if (!connector) return { ok: false, error: "Servicio no conectable." }

  // Filtrar a solo los campos declarados por el conector (ignora llaves ajenas).
  const clean: Record<string, string> = {}
  for (const f of connector.fields) {
    const v = parsed.data.values[f.key]
    if (typeof v === "string" && v.trim()) clean[f.key] = v.trim()
  }
  if (Object.keys(clean).length === 0) return { ok: false, error: "No hay nada que guardar." }

  const res = await saveConnection(provider, clean, userId)
  if (res.ok) revalidatePath("/settings")
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

/** Borra las credenciales guardadas de un servicio (vuelve a env). Solo admin. */
export async function clearConnectionAction(
  key: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await currentAdminId())) return { ok: false, error: "Solo un admin." }
  const parsed = KeySchema.safeParse(key)
  if (!parsed.success) return { ok: false, error: "Servicio inválido." }
  const res = await clearConnection(parsed.data as IntegrationKey)
  if (res.ok) revalidatePath("/settings")
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}
