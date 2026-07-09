"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"

type TypedClient = SupabaseClient<Database>

// Base de la API de Square (mismo default que src/lib/integrations/square.ts).
const SQUARE_API_BASE = process.env.SQUARE_API_BASE_URL ?? "https://connect.squareup.com"

async function typedClient(): Promise<TypedClient> {
  return (await createClient()) as unknown as TypedClient
}

async function assertAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "No autenticado" }
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single()
  if (profile?.role !== "admin") {
    return { ok: false, error: "Solo admins pueden gestionar el mapa de ofertas" }
  }
  return { ok: true, userId: user.id }
}

const OfferMapSchema = z.object({
  provider: z.enum(["square", "stripe"]),
  offer_key: z.string().min(1, "offer_key requerido").transform((v) => v.trim()),
  offer_label: z
    .string()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  brand_id: z.string().uuid("Marca requerida"),
  active: z.boolean().default(true),
})

export type OfferMapInput = z.input<typeof OfferMapSchema>

export async function createOfferMap(
  raw: OfferMapInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const input = OfferMapSchema.parse(raw)
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const admin = createAdminClient() as unknown as TypedClient
    const { data, error } = await admin
      .from("offer_brand_map")
      .insert({
        provider: input.provider,
        offer_key: input.offer_key,
        offer_label: input.offer_label,
        brand_id: input.brand_id,
        active: input.active,
      })
      .select("id")
      .single()

    if (error || !data) {
      console.error("[createOfferMap]", error?.message, error?.code)
      return { ok: false, error: error?.message ?? "No se pudo crear" }
    }

    revalidatePath("/settings")
    return { ok: true, id: (data as { id: string }).id }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Datos inválidos" }
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[createOfferMap] threw:", msg)
    return { ok: false, error: msg }
  }
}

const UpdateOfferMapSchema = OfferMapSchema.extend({ id: z.string().uuid() })
export type UpdateOfferMapInput = z.input<typeof UpdateOfferMapSchema>

export async function updateOfferMap(
  raw: UpdateOfferMapInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { id, ...input } = UpdateOfferMapSchema.parse(raw)
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const admin = createAdminClient() as unknown as TypedClient
    const { error } = await admin
      .from("offer_brand_map")
      .update({
        provider: input.provider,
        offer_key: input.offer_key,
        offer_label: input.offer_label,
        brand_id: input.brand_id,
        active: input.active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)

    if (error) {
      console.error("[updateOfferMap]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Datos inválidos" }
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[updateOfferMap] threw:", msg)
    return { ok: false, error: msg }
  }
}

export async function toggleOfferMapActive(
  id: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!id || typeof active !== "boolean") {
      return { ok: false, error: "Parámetros inválidos" }
    }
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const admin = createAdminClient() as unknown as TypedClient
    const { error } = await admin
      .from("offer_brand_map")
      .update({ active, updated_at: new Date().toISOString() })
      .eq("id", id)

    if (error) {
      console.error("[toggleOfferMapActive]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[toggleOfferMapActive] threw:", msg)
    return { ok: false, error: msg }
  }
}

export async function deactivateOfferMap(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return toggleOfferMapActive(id, false)
}

// ── Jalar servicios de Square (Catalog API) ──────────────────────────────────

export type SquareServiceOption = { variationId: string; name: string }

type SquareCatalogVariation = {
  id?: string
  item_variation_data?: { name?: string }
}
type SquareCatalogObject = {
  type?: string
  id?: string
  item_data?: {
    name?: string
    product_type?: string
    variations?: SquareCatalogVariation[]
  }
}

/**
 * Lista los servicios de citas (product_type === "APPOINTMENTS_SERVICE") del
 * catálogo de Square, devolviendo una fila por variación (id + nombre legible).
 * Si no hay token o la llamada falla, devuelve [] — NO bloquea.
 */
export async function pullSquareServices(): Promise<
  { ok: true; services: SquareServiceOption[] } | { ok: false; error: string }
> {
  const guard = await assertAdmin()
  if (!guard.ok) return guard

  const token = process.env.SQUARE_ACCESS_TOKEN
  if (!token) return { ok: true, services: [] }

  try {
    const services: SquareServiceOption[] = []
    // Endpoint dedicado a servicios de citas: Square filtra product_type
    // APPOINTMENTS_SERVICE del lado del servidor (doc oficial), así no se
    // saltan servicios aunque el catálogo tenga muchos productos/planes.
    // Paginamos por cursor (tope defensivo de 20 páginas).
    let cursor: string | undefined = undefined
    for (let page = 0; page < 20; page++) {
      const res: Response = await fetch(
        `${SQUARE_API_BASE}/v2/catalog/search-catalog-items`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "Square-Version": "2025-01-23",
          },
          body: JSON.stringify({
            product_types: ["APPOINTMENTS_SERVICE"],
            ...(cursor ? { cursor } : {}),
          }),
        },
      )
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        console.error("[pullSquareServices] Square", res.status, text.slice(0, 200))
        break
      }
      const json = (await res.json()) as {
        items?: SquareCatalogObject[]
        cursor?: string
      }
      for (const obj of json.items ?? []) {
        const item = obj.item_data
        if (!item) continue
        const itemName = item.name ?? "Servicio"
        for (const v of item.variations ?? []) {
          if (!v.id) continue
          const varName = v.item_variation_data?.name
          const name = varName ? `${itemName} — ${varName}` : itemName
          services.push({ variationId: v.id, name })
        }
      }
      cursor = json.cursor
      if (!cursor) break
    }
    return { ok: true, services }
  } catch (e) {
    console.error(
      "[pullSquareServices] threw:",
      e instanceof Error ? e.message : String(e),
    )
    return { ok: true, services: [] }
  }
}
