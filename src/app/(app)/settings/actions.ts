"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

const UpdateProfileSchema = z.object({
  name: z.string().min(1),
  cell_phone: z.string().nullable(),
})

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>

export async function updateProfile(raw: UpdateProfileInput) {
  const input = UpdateProfileSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { error } = await supabase
    .from("users")
    .update({ name: input.name, cell_phone: input.cell_phone })
    .eq("id", user.id)

  if (error) throw new Error(error.message)
  revalidatePath("/settings")
  revalidatePath("/dashboard")
}

const UpdateBrandSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  brand_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Color inválido (usa formato #RRGGBB)").nullable(),
  logo_url: z.string().url("URL inválida").nullable().or(z.literal("").transform(() => null)),
})

export type UpdateBrandInput = z.infer<typeof UpdateBrandSchema>

export async function updateBrand(raw: UpdateBrandInput) {
  const input = UpdateBrandSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") throw new Error("Solo admins pueden editar la marca")

  const { error } = await supabase
    .from("brands")
    .update({ name: input.name, brand_color: input.brand_color, logo_url: input.logo_url })
    .eq("id", input.id)

  if (error) throw new Error(error.message)
  revalidatePath("/settings")
  revalidatePath("/dashboard")
}
