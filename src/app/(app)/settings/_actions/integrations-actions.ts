"use server"

import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createClient } from "@/lib/supabase/server"
import { testIntegration } from "@/lib/integrations/health"

async function isAdmin(): Promise<boolean> {
  const sb = (await createClient()) as unknown as SupabaseClient<Database>
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return false
  const { data } = await sb.from("users").select("role").eq("id", user.id).single()
  return data?.role === "admin"
}

const KeySchema = z.enum([
  "stripe", "square", "meta", "eighthundred", "practicebetter", "whatsapp", "hermes_vps",
])

/** Prueba en vivo la conexión de un servicio. Solo admin. Nunca expone secretos. */
export async function testIntegrationAction(
  key: string,
): Promise<{ ok: boolean; detail: string }> {
  if (!(await isAdmin())) return { ok: false, detail: "Solo un admin puede probar conexiones." }
  const parsed = KeySchema.safeParse(key)
  if (!parsed.success) return { ok: false, detail: "Servicio inválido." }
  return testIntegration(parsed.data)
}
