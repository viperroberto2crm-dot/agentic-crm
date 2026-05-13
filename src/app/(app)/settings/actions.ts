"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"

type UserRole = Database["public"]["Enums"]["user_role"]

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

// ── Users ─────────────────────────────────────────────────────────────────────

const InviteUserSchema = z.object({
  email: z.string().email("Email inválido"),
  name: z.string().min(1, "Nombre requerido"),
  role: z.enum(["admin", "manager", "rep"]),
  brand_id: z.string().uuid().nullable(),
})

export type InviteUserInput = z.infer<typeof InviteUserSchema>

export async function inviteUser(raw: InviteUserInput) {
  const input = InviteUserSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  if (!input.brand_id) throw new Error("Se requiere una marca activa para invitar usuarios")

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") throw new Error("Solo admins pueden invitar usuarios")

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    data: {
      name: input.name,
      role: input.role,
      ...(input.brand_id ? { brand_id: input.brand_id } : {}),
    },
  })

  if (error) throw new Error(error.message)
  revalidatePath("/settings")
  revalidatePath("/dashboard")
}

const UpdateUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Nombre requerido"),
  role: z.enum(["admin", "manager", "rep"]),
  active: z.boolean(),
  brand_id: z.string().uuid(),
})

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>

export async function updateUser(raw: UpdateUserInput) {
  const input = UpdateUserSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") throw new Error("Solo admins pueden editar usuarios")

  if (input.id === user.id && !input.active) throw new Error("No puedes desactivar tu propia cuenta")

  // Verify target user belongs to the same brand to prevent cross-brand escalation
  const { data: membership } = await supabase
    .from("user_brands")
    .select("user_id")
    .eq("user_id", input.id)
    .eq("brand_id", input.brand_id)
    .single()
  if (!membership) throw new Error("No autorizado: el usuario no pertenece a esta marca")

  const { error } = await supabase
    .from("users")
    .update({ name: input.name, role: input.role as UserRole, active: input.active })
    .eq("id", input.id)

  if (error) throw new Error(error.message)
  revalidatePath("/settings")
  revalidatePath("/dashboard")
}
