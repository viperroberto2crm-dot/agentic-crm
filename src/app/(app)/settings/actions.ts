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
  password: z.string().min(8, "Contraseña mínimo 8 caracteres"),
})

export type InviteUserInput = z.infer<typeof InviteUserSchema>

export async function inviteUser(raw: InviteUserInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = InviteUserSchema.parse(raw)
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    if (!input.brand_id) return { ok: false, error: "Se requiere una marca activa para invitar usuarios" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden invitar usuarios" }

    const admin = createAdminClient()
    // Try to create user with password (no invite email needed)
    const { data: createData, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        name: input.name,
        role: input.role,
        ...(input.brand_id ? { brand_id: input.brand_id } : {}),
      },
    })

    if (error) {
      // User already exists — update their record
      if (error.message.toLowerCase().includes("already") || error.code === "email_exists") {
        const { error: updateErr } = await admin
          .from("users")
          .update({ name: input.name, role: input.role as UserRole })
          .eq("email", input.email)
        if (updateErr) return { ok: false, error: updateErr.message }
      } else {
        return { ok: false, error: error.message }
      }
    } else if (createData?.user) {
      // The DB trigger handle_new_user() creates the public.users profile
      // and user_brands association automatically from user_metadata.
      // We do a fallback upsert in case the trigger is not installed.
      await admin.from("users").upsert({
        id: createData.user.id,
        email: input.email,
        name: input.name,
        role: input.role as UserRole,
        active: true,
      }, { onConflict: "id" })

      if (input.brand_id) {
        await admin.from("user_brands").upsert({
          user_id: createData.user.id,
          brand_id: input.brand_id,
        }, { onConflict: "user_id,brand_id" })
      }
    }

    revalidatePath("/settings")
    revalidatePath("/dashboard")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error desconocido" }
  }
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

export async function deleteUser(userId: string, brandId: string) {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") throw new Error("Solo admins pueden eliminar usuarios")

  if (userId === user.id) throw new Error("No puedes eliminar tu propia cuenta")

  const { data: membership } = await supabase
    .from("user_brands")
    .select("user_id")
    .eq("user_id", userId)
    .eq("brand_id", brandId)
    .single()
  if (!membership) throw new Error("No autorizado: el usuario no pertenece a esta marca")

  const admin = createAdminClient()
  const { error: authErr } = await admin.auth.admin.deleteUser(userId)
  if (authErr) throw new Error(authErr.message)

  revalidatePath("/settings")
  revalidatePath("/dashboard")
}

// ── Products ───────────────────────────────────────────────────────────────────

const CADENCE_DAYS: Record<string, number> = { weekly: 7, monthly: 30, annual: 365 }

const ProductSchema = z.object({
  brand_id: z.string().uuid(),
  name: z.string().min(1, "Nombre requerido"),
  category: z.string().min(1, "Categoría requerida"),
  sku: z.string().nullable(),
  description: z.string().nullable(),
  price_cents: z.number().int().min(0),
  display_price_cents: z.number().int().min(0).nullable(),
  display_unit: z.string().nullable(),
  cadence: z.enum(["weekly", "monthly", "annual"]),
  recurring: z.boolean(),
  best_value: z.boolean(),
  active: z.boolean(),
  included_services: z.array(z.string()),
})

export type ProductInput = z.infer<typeof ProductSchema>

async function assertAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.from("users").select("role").eq("id", userId).single()
  if (data?.role !== "admin") throw new Error("Solo admins pueden gestionar productos")
}

export async function createProduct(raw: ProductInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = ProductSchema.parse(raw)
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden gestionar productos" }

    const admin = createAdminClient()
    const { error } = await admin
      .from("products")
      .insert({
        ...input,
        billing_cycle_days: CADENCE_DAYS[input.cadence],
        sort_order: 0,
      })

    if (error) {
      console.error("[createProduct]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[createProduct] threw:", msg)
    return { ok: false, error: msg }
  }
}

const UpdateProductSchema = ProductSchema.extend({ id: z.string().uuid() })
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>

export async function updateProduct(raw: UpdateProductInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { id, ...input } = UpdateProductSchema.parse(raw)
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden gestionar productos" }

    const admin = createAdminClient()
    const { error } = await admin
      .from("products")
      .update({ ...input, billing_cycle_days: CADENCE_DAYS[input.cadence] })
      .eq("id", id)
      .eq("brand_id", input.brand_id)

    if (error) {
      console.error("[updateProduct]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[updateProduct] threw:", msg)
    return { ok: false, error: msg }
  }
}

// ── Clinics ────────────────────────────────────────────────────────────────────

const ClinicSchema = z.object({
  brand_id: z.string().uuid(),
  name: z.string().min(1, "Nombre requerido"),
  address_line1: z.string().nullable(),
  address_line2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  phone: z.string().nullable(),
  active: z.boolean().default(true),
})

export type ClinicInput = z.infer<typeof ClinicSchema>

export async function createClinic(raw: ClinicInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = ClinicSchema.parse(raw)
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden gestionar clínicas" }

    const admin = createAdminClient()
    const { error } = await admin
      .from("clinics")
      .insert(input)

    if (error) {
      console.error("[createClinic]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[createClinic] threw:", msg)
    return { ok: false, error: msg }
  }
}

const UpdateClinicSchema = ClinicSchema.extend({ id: z.string().uuid() })
export type UpdateClinicInput = z.infer<typeof UpdateClinicSchema>

export async function updateClinic(raw: UpdateClinicInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { id, ...input } = UpdateClinicSchema.parse(raw)
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden gestionar clínicas" }

    const admin = createAdminClient()
    const { error } = await admin
      .from("clinics")
      .update(input)
      .eq("id", id)
      .eq("brand_id", input.brand_id)

    if (error) {
      console.error("[updateClinic]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[updateClinic] threw:", msg)
    return { ok: false, error: msg }
  }
}

export async function toggleClinicActive(
  id: string,
  active: boolean,
  brandId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!id || typeof active !== "boolean" || !brandId) {
      return { ok: false, error: "Parámetros inválidos" }
    }
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden gestionar clínicas" }

    const admin = createAdminClient()
    const { error } = await admin
      .from("clinics")
      .update({ active })
      .eq("id", id)
      .eq("brand_id", brandId)

    if (error) {
      console.error("[toggleClinicActive]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[toggleClinicActive] threw:", msg)
    return { ok: false, error: msg }
  }
}

// ── Brands (CRUD multi-marca) ─────────────────────────────────────────────────

const emptyToNull = (v: string | null | undefined) => {
  if (v === null || v === undefined) return null
  const t = v.trim()
  return t === "" ? null : t
}

const BrandSchema = z.object({
  name: z.string().min(1, "Nombre requerido"),
  slug: z
    .string()
    .min(1, "Slug requerido")
    .regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones"),
  brand_color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color inválido (usa formato #RRGGBB)")
    .nullable()
    .or(z.literal("").transform(() => null)),
  logo_url: z.string().url("URL inválida").nullable().or(z.literal("").transform(() => null)),
  reply_email: z.string().email("Email inválido").nullable().or(z.literal("").transform(() => null)),
  whatsapp_number: z.string().nullable().or(z.literal("").transform(() => null)),
  active: z.boolean().default(true),
})

export type BrandInput = z.infer<typeof BrandSchema>

export async function createBrand(
  raw: BrandInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const input = BrandSchema.parse({
      ...raw,
      logo_url: emptyToNull(raw.logo_url as string | null),
      reply_email: emptyToNull(raw.reply_email as string | null),
      whatsapp_number: emptyToNull(raw.whatsapp_number as string | null),
      brand_color: emptyToNull(raw.brand_color as string | null),
    })
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden gestionar marcas" }

    const admin = createAdminClient()
    const { data: inserted, error } = await admin
      .from("brands")
      .insert({
        name: input.name,
        slug: input.slug,
        brand_color: input.brand_color,
        logo_url: input.logo_url,
        reply_email: input.reply_email,
        whatsapp_number: input.whatsapp_number,
        active: input.active,
      })
      .select("id")
      .single()

    if (error || !inserted) {
      console.error("[createBrand]", error?.message, error?.code)
      return { ok: false, error: error?.message ?? "No se pudo crear la marca" }
    }

    // Asocia al admin creador con la nueva marca para que aparezca en el selector global
    const { error: ubErr } = await admin
      .from("user_brands")
      .upsert(
        { user_id: user.id, brand_id: inserted.id },
        { onConflict: "user_id,brand_id" },
      )
    if (ubErr) {
      console.error("[createBrand:user_brands]", ubErr.message, ubErr.code)
      // No abortamos: la marca se creó; solo logueamos el warning
    }

    revalidatePath("/settings")
    revalidatePath("/dashboard")
    return { ok: true, id: inserted.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[createBrand] threw:", msg)
    return { ok: false, error: msg }
  }
}

const UpdateBrandFullSchema = BrandSchema.extend({ id: z.string().uuid() })
export type UpdateBrandFullInput = z.infer<typeof UpdateBrandFullSchema>

export async function updateBrandFull(
  raw: UpdateBrandFullInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const parsed = UpdateBrandFullSchema.parse({
      ...raw,
      logo_url: emptyToNull(raw.logo_url as string | null),
      reply_email: emptyToNull(raw.reply_email as string | null),
      whatsapp_number: emptyToNull(raw.whatsapp_number as string | null),
      brand_color: emptyToNull(raw.brand_color as string | null),
    })
    const { id, ...input } = parsed
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden gestionar marcas" }

    const admin = createAdminClient()
    const { error } = await admin
      .from("brands")
      .update({
        name: input.name,
        slug: input.slug,
        brand_color: input.brand_color,
        logo_url: input.logo_url,
        reply_email: input.reply_email,
        whatsapp_number: input.whatsapp_number,
        active: input.active,
      })
      .eq("id", id)

    if (error) {
      console.error("[updateBrandFull]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    revalidatePath("/dashboard")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[updateBrandFull] threw:", msg)
    return { ok: false, error: msg }
  }
}

export async function toggleBrandActive(
  id: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!id || typeof active !== "boolean") {
      return { ok: false, error: "Parámetros inválidos" }
    }
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden gestionar marcas" }

    const admin = createAdminClient()
    const { error } = await admin
      .from("brands")
      .update({ active })
      .eq("id", id)

    if (error) {
      console.error("[toggleBrandActive]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    revalidatePath("/dashboard")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[toggleBrandActive] threw:", msg)
    return { ok: false, error: msg }
  }
}
