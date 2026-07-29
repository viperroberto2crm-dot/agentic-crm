"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"
import { assertNotProvider, getCurrentRole } from "@/lib/auth/role-guards"
import { normalizeToE164 } from "@/lib/integrations/800com"

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

const VALID_SOURCES = ["inbound_call", "web_form", "referral", "whatsapp", "walk_in", "social", "facebook", "other"] as const
type LeadSource = typeof VALID_SOURCES[number]

const ImportRowSchema = z.object({
  first_name: z.string().min(1, "Nombre requerido"),
  last_name: z.string().nullable(),
  phone: z.preprocess(
    (v) => {
      if (typeof v !== "string") return v
      const t = v.trim()
      return t ? normalizeToE164(t) || t : null
    },
    z.union([z.string().min(6, "Teléfono inválido"), z.null()])
  ),
  email: z.string().email("Email inválido").nullable().or(z.literal("").transform(() => null)),
  source: z.preprocess(
    (v) => {
      if (!v || v === "") return null
      return (VALID_SOURCES as readonly string[]).includes(v as string) ? v : "other"
    },
    z.enum(VALID_SOURCES).nullable().optional()
  ),
  notes: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
})

export type ImportRow = z.infer<typeof ImportRowSchema>

export type ImportResult = {
  imported: number
  skipped: number
  errors: Array<{ row: number; message: string }>
}

export async function importLeads(
  rows: ImportRow[],
  brandId: string,
  assignedRepId: string | null
): Promise<ImportResult> {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const result: ImportResult = { imported: 0, skipped: 0, errors: [] }

  const BATCH_SIZE = 500

  // Validate and collect valid rows
  const validRows: Database["public"]["Tables"]["leads"]["Insert"][] = []

  for (let i = 0; i < rows.length; i++) {
    const parsed = ImportRowSchema.safeParse(rows[i])
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join(", ")
      result.errors.push({ row: i + 1, message: msg })
      result.skipped++
      continue
    }
    validRows.push({
      brand_id: brandId,
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
      phone: parsed.data.phone,
      email: parsed.data.email,
      source: parsed.data.source ?? null,
      notes: parsed.data.notes,
      city: parsed.data.city,
      state: parsed.data.state,
      assigned_rep_id: assignedRepId ?? user.id,
      created_by: user.id,
    })
  }

  // Insert in batches of 500
  for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
    const batch = validRows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from("leads").insert(batch)
    if (error) {
      // Mark entire batch as error
      result.errors.push({
        row: i + 1,
        message: `Batch error: ${error.message}`,
      })
      result.skipped += batch.length
    } else {
      result.imported += batch.length
    }
  }

  revalidatePath("/leads")
  revalidatePath("/dashboard")
  return result
}

export async function fetchRepsForImport() {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: profile } = await supabase
    .from("users").select("role").eq("id", user.id).single()

  if (profile?.role === "rep") return []

  const { data } = await supabase
    .from("users").select("id, name").eq("active", true).order("name")
  return (data ?? []) as { id: string; name: string }[]
}
