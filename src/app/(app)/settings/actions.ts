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

/**
 * Asegura que un usuario tenga las asociaciones user_brands correctas según su rol:
 * - admin → asociado a TODAS las marcas activas (acceso global)
 * - manager / rep → asociado solo a la marca específica (currentBrandId)
 *
 * NUNCA elimina asociaciones existentes — solo agrega las faltantes. Si un admin baja
 * de rango, sus user_brands antiguos quedan (no estorba; el rol nuevo no autoriza nada
 * por sí solo, las queries siguen filtrando por rol).
 */
async function ensureUserBrandsForRole(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  role: UserRole | string,
  currentBrandId: string | null,
) {
  if (role === "admin") {
    const { data: allBrands } = await admin
      .from("brands")
      .select("id")
      .eq("active", true)
    const rows = (allBrands ?? []).map((b) => ({ user_id: userId, brand_id: b.id }))
    if (rows.length > 0) {
      await admin
        .from("user_brands")
        .upsert(rows, { onConflict: "user_id,brand_id" })
    }
  } else if (currentBrandId) {
    await admin
      .from("user_brands")
      .upsert(
        { user_id: userId, brand_id: currentBrandId },
        { onConflict: "user_id,brand_id" },
      )
  }
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

const UpdatePasswordSchema = z.object({
  newPassword: z.string().min(8, "PASSWORD_TOO_SHORT"),
})
export type UpdatePasswordInput = z.infer<typeof UpdatePasswordSchema>

export async function updateOwnPassword(
  raw: UpdatePasswordInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = UpdatePasswordSchema.parse(raw)
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    // updateUser actualiza la contraseña del usuario autenticado
    const { error } = await supabase.auth.updateUser({ password: input.newPassword })
    if (error) {
      console.error("[updateOwnPassword]", error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Invalid input" }
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[updateOwnPassword] threw:", msg)
    return { ok: false, error: msg }
  }
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
  role: z.enum(["admin", "manager", "rep", "provider"]),
  brand_id: z.string().uuid().nullable(),
  all_brands: z.boolean().optional().default(false),
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

      // Si pidió "all_brands", forzamos rol-admin-like en la asignación
      // (linkear a TODAS las brands activas) aunque sea rep/manager.
      const effectiveRoleForBrands = input.all_brands ? "admin" : input.role
      await ensureUserBrandsForRole(admin, createData.user.id, effectiveRoleForBrands, input.brand_id)
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
  role: z.enum(["admin", "manager", "rep", "provider"]),
  active: z.boolean(),
  brand_id: z.string().uuid(),
})

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>

export async function updateUser(
  raw: UpdateUserInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = UpdateUserSchema.parse(raw)
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden editar usuarios" }

    if (input.id === user.id && !input.active) return { ok: false, error: "No puedes desactivar tu propia cuenta" }

    // Verify target user belongs to the same brand to prevent cross-brand escalation
    const { data: membership } = await supabase
      .from("user_brands")
      .select("user_id")
      .eq("user_id", input.id)
      .eq("brand_id", input.brand_id)
      .maybeSingle()
    if (!membership) return { ok: false, error: "El usuario no pertenece a esta marca" }

    const { error: updErr } = await supabase
      .from("users")
      .update({ name: input.name, role: input.role as UserRole, active: input.active })
      .eq("id", input.id)
    if (updErr) return { ok: false, error: updErr.message }

    // Si el rol resultante es admin, asegurar acceso a TODAS las marcas activas.
    try {
      const admin = createAdminClient()
      await ensureUserBrandsForRole(admin, input.id, input.role, input.brand_id)
    } catch (err) {
      console.error("[updateUser] ensureUserBrandsForRole failed:", err)
      // No bloqueamos por esto — el update principal ya está hecho
    }

    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido"
    console.error("[updateUser] unhandled:", msg, e)
    return { ok: false, error: msg }
  }
}

export async function deleteUser(
  userId: string,
  brandId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden eliminar usuarios" }

    if (userId === user.id) return { ok: false, error: "No puedes eliminar tu propia cuenta" }

    const { data: membership } = await supabase
      .from("user_brands")
      .select("user_id")
      .eq("user_id", userId)
      .eq("brand_id", brandId)
      .maybeSingle()
    if (!membership) return { ok: false, error: "El usuario no pertenece a esta marca" }

    const admin = createAdminClient()
    const { error: authErr } = await admin.auth.admin.deleteUser(userId)
    if (authErr) {
      // FK constraints (sales.rep_id NO ACTION, etc.) suelen rebotar acá con mensaje claro.
      // Si el delete del auth falla, public.users queda intacto.
      return {
        ok: false,
        error: `No se pudo eliminar: ${authErr.message}. Tip: si tiene ventas/llamadas asociadas, desactivá el usuario en vez de borrarlo.`,
      }
    }

    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido"
    console.error("[deleteUser] unhandled:", msg, e)
    return { ok: false, error: msg }
  }
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

const DeleteProductSchema = z.object({
  id: z.string().uuid(),
  brand_id: z.string().uuid(),
})
export type DeleteProductInput = z.infer<typeof DeleteProductSchema>

export async function deleteProduct(
  raw: DeleteProductInput,
): Promise<{ ok: true } | { ok: false; error: string; inUse?: boolean }> {
  try {
    const input = DeleteProductSchema.parse(raw)
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden gestionar productos" }

    const admin = createAdminClient()

    // Check if product is referenced by any sale_items — if so, refuse hard delete
    // and let the caller deactivate instead.
    const { count, error: countErr } = await admin
      .from("sale_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", input.id)

    if (countErr) {
      console.error("[deleteProduct] count check failed:", countErr.message)
      return { ok: false, error: countErr.message }
    }

    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error: "PRODUCT_IN_USE",
        inUse: true,
      }
    }

    const { error } = await admin
      .from("products")
      .delete()
      .eq("id", input.id)
      .eq("brand_id", input.brand_id)

    if (error) {
      console.error("[deleteProduct]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[deleteProduct] threw:", msg)
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

const DeleteClinicSchema = z.object({
  id: z.string().uuid(),
  brand_id: z.string().uuid(),
})
export type DeleteClinicInput = z.infer<typeof DeleteClinicSchema>

export async function deleteClinic(
  raw: DeleteClinicInput,
): Promise<{ ok: true } | { ok: false; error: string; inUse?: boolean }> {
  try {
    const input = DeleteClinicSchema.parse(raw)
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden gestionar clínicas" }

    const admin = createAdminClient()

    // Refuse hard-delete if clinic is referenced by appointments.
    const { count, error: countErr } = await admin
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", input.id)

    if (countErr) {
      console.error("[deleteClinic] count check failed:", countErr.message)
      return { ok: false, error: countErr.message }
    }

    if ((count ?? 0) > 0) {
      return { ok: false, error: "CLINIC_IN_USE", inUse: true }
    }

    const { error } = await admin
      .from("clinics")
      .delete()
      .eq("id", input.id)
      .eq("brand_id", input.brand_id)

    if (error) {
      console.error("[deleteClinic]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[deleteClinic] threw:", msg)
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

    // Asocia TODOS los admins activos con la nueva marca (acceso global por rol)
    const { data: admins } = await admin
      .from("users")
      .select("id")
      .eq("role", "admin")
      .eq("active", true)
    const rows = (admins ?? []).map((a) => ({
      user_id: a.id,
      brand_id: inserted.id,
    }))
    // Asegura al creador en la lista por si la query falló o el creador es admin nuevo
    if (!rows.some((r) => r.user_id === user.id)) {
      rows.push({ user_id: user.id, brand_id: inserted.id })
    }
    const { error: ubErr } = await admin
      .from("user_brands")
      .upsert(rows, { onConflict: "user_id,brand_id" })
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

export async function deleteBrand(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; inUse?: boolean }> {
  try {
    if (!id) return { ok: false, error: "Parámetros inválidos" }
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }

    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden gestionar marcas" }

    const admin = createAdminClient()

    // Refuse hard-delete if brand has any leads, products, sales, or appointments.
    // Para protegerse de borrar data importante, cualquier referencia bloquea.
    for (const tbl of ["leads", "products", "sales", "appointments", "clinics"] as const) {
      const { count, error } = await admin
        .from(tbl)
        .select("id", { count: "exact", head: true })
        .eq("brand_id", id)
      if (error) {
        console.error(`[deleteBrand] check ${tbl} failed:`, error.message)
        return { ok: false, error: error.message }
      }
      if ((count ?? 0) > 0) {
        return { ok: false, error: "BRAND_IN_USE", inUse: true }
      }
    }

    // user_brands tiene CASCADE → se borra solo. Borramos la brand.
    const { error } = await admin.from("brands").delete().eq("id", id)
    if (error) {
      console.error("[deleteBrand]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    revalidatePath("/dashboard")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[deleteBrand] threw:", msg)
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
