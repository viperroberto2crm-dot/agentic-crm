/**
 * Ruteo automático de ofertas → creación de leads (offer routing).
 *
 * Objetivo: cuando un pago/cita de Square o Stripe NO matchea contra un lead
 * existente (el "camino feliz" de resolveLead), intentar CREAR el lead en la
 * clínica correcta usando el mapa oferta→marca (offer_brand_map).
 *
 * Reglas de oro (leer antes de tocar):
 *   - Match SOLO por ID exacto (service_variation_id / catalog_object_id /
 *     price.id). NUNCA por nombre difuso: un match equivocado mandaría un
 *     paciente a la clínica y Practice Better equivocados = fuga de datos.
 *   - Si las ofertas apuntan a >1 marca distinta → no se adivina (null).
 *   - Ofertas NO mapeadas → marca centinela 'unassigned' (active=false). El
 *     lead NUNCA se pierde: queda visible en /admin/external-unlinked.
 *   - Push a Practice Better SOLO si el lead se CREÓ y la oferta estaba mapeada
 *     a una marca REAL (no 'unassigned').
 *   - Idempotencia a nivel BASE DE DATOS: índice único parcial
 *     leads (external_provider, external_id). Este módulo también la maneja en
 *     código (dedup + captura de violación única en carreras).
 *   - Todo detrás de feature flags (default OFF): con las flags apagadas,
 *     routeAndCreateLead() devuelve null y el webhook se comporta como hoy.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { escapeIlike } from "@/lib/queries/search"
import { findOrCreatePbRecord } from "@/lib/integrations/pb-dedup"
import type { PbAddress } from "@/lib/integrations/practice-better"

type DB = SupabaseClient<Database>

export type RoutingProvider = "square" | "stripe"

const UNASSIGNED_SLUG = "unassigned"

/** Slugs con Practice Better habilitado, desde env CSV. Mismo patrón que submit.ts. */
function pbEnabledSlugs(): Set<string> {
  const csv = process.env.PRACTICE_BETTER_BRAND_SLUGS ?? ""
  return new Set(
    csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

// ── Resolución de marca por oferta (SOLO ID exacto) ──────────────────────────

/**
 * Resuelve la marca a partir de las llaves candidatas de una oferta.
 * SELECT offer_brand_map WHERE provider=... AND active=true AND offer_key IN (...).
 * Si las filas apuntan a >1 marca distinta → null (no adivinar). Sin fallback
 * por nombre. Devuelve null si no hay match.
 */
export async function resolveOfferBrand(
  sb: DB,
  provider: RoutingProvider,
  candidateKeys: string[],
): Promise<{ brandId: string; offerLabel: string | null } | null> {
  const keys = Array.from(new Set((candidateKeys ?? []).filter(Boolean)))
  if (keys.length === 0) return null

  const { data, error } = await sb
    .from("offer_brand_map")
    .select("brand_id, offer_label")
    .eq("provider", provider)
    .eq("active", true)
    .in("offer_key", keys)
  if (error || !data || data.length === 0) return null

  const rows = data as { brand_id: string; offer_label: string | null }[]
  const brandIds = new Set(rows.map((r) => r.brand_id))
  if (brandIds.size > 1) return null // apunta a >1 clínica: no adivinar

  return { brandId: rows[0].brand_id, offerLabel: rows[0].offer_label }
}

/** Id de la marca centinela 'unassigned'. null si el SQL no se ha corrido. */
export async function getUnassignedBrandId(sb: DB): Promise<string | null> {
  const { data } = await sb
    .from("brands")
    .select("id")
    .eq("slug", UNASSIGNED_SLUG)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

// ── Dedup ────────────────────────────────────────────────────────────────────

/** Busca un lead por (external_provider, external_id). Calco de findLeadByMetaId. */
export async function findLeadByExternalId(
  sb: DB,
  provider: RoutingProvider,
  externalId: string,
): Promise<string | null> {
  const { data } = await sb
    .from("leads")
    .select("id")
    .eq("external_provider", provider)
    .eq("external_id", externalId)
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/**
 * Busca un lead dentro de una marca por email (escapado) y luego por teléfono.
 * Calco del dedup de submitIntake. Aplica también cuando la marca es 'unassigned'.
 */
export async function findLeadByEmailOrPhone(
  sb: DB,
  brandId: string,
  email: string | null,
  phone: string | null,
): Promise<string | null> {
  if (email) {
    const { data } = await sb
      .from("leads")
      .select("id")
      .eq("brand_id", brandId)
      .ilike("email", escapeIlike(email))
      .limit(1)
      .maybeSingle()
    if ((data as { id: string } | null)?.id) return (data as { id: string }).id
  }
  if (phone) {
    const { data } = await sb
      .from("leads")
      .select("id")
      .eq("brand_id", brandId)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle()
    if ((data as { id: string } | null)?.id) return (data as { id: string }).id
  }
  return null
}

/**
 * Deriva lead_source. Square presencial (origin='in_person') → 'walk_in'
 * (ya existe en el enum); en cualquier otro caso el propio proveedor
 * ('square' / 'stripe', agregados al enum por el SQL de esta pieza).
 */
export function deriveLeadSource(
  provider: RoutingProvider,
  origin?: string | null,
): string {
  if (provider === "square" && origin === "in_person") return "walk_in"
  return provider
}

// ── Notas del lead auto-creado ───────────────────────────────────────────────

function buildNotes(
  provider: RoutingProvider,
  mapMatch: { offerLabel: string | null } | null,
  origin: string | null | undefined,
  noteSuffix: string | null | undefined,
): string {
  const label = provider === "square" ? "Square" : "Stripe"
  const parts: string[] = [`Lead auto-creado desde ${label} (ruteo automático de ofertas)`]
  if (mapMatch) {
    parts.push(`Oferta mapeada: ${mapMatch.offerLabel ?? "(sin etiqueta)"}`)
  } else {
    parts.push("Oferta NO mapeada → marca 'Sin Asignar' (reasignar manualmente)")
  }
  if (origin) parts.push(`Origen: ${origin}`)
  if (noteSuffix) parts.push(noteSuffix)
  return parts.join(". ")
}

// ── Core: rutea y crea (o reusa) el lead ─────────────────────────────────────

export type RouteAndCreateParams = {
  provider: RoutingProvider
  candidateKeys: string[]
  origin?: string | null
  externalCustomerId?: string | null
  contact: {
    email?: string | null
    phone?: string | null
    name?: string | null // nombre completo (fallback / customer_name)
    firstName?: string | null // nombre de pila (Square given_name) para PB
    lastName?: string | null // apellido (Square family_name) para PB
    address?: string | null // dirección legible (para el lead)
  }
  /** Dirección estructurada para el perfil de Practice Better. */
  pbAddress?: PbAddress | null
  /** Nota para el perfil de PB (ej. detalle del pago Square). */
  pbNote?: string | null
  noteSuffix?: string | null
}

/**
 * Rutea un pago/cita sin lead a la clínica correcta y crea (o reusa) el lead.
 * Devuelve { leadId, brandId } si logró vincular/crear; null si no aplica
 * (flags off, dry-run, o falta la marca centinela).
 */
export async function routeAndCreateLead(
  sb: DB,
  params: RouteAndCreateParams,
): Promise<{ leadId: string; brandId: string } | null> {
  const { provider, candidateKeys, origin, externalCustomerId, contact, noteSuffix, pbAddress, pbNote } = params

  // ── Feature flags (default OFF → comportamiento idéntico al de hoy) ──────────
  if (process.env.OFFER_BRAND_MAP_ENABLED !== "true") return null
  const perProviderFlag =
    provider === "square"
      ? process.env.SQUARE_AUTO_CREATE_LEADS
      : process.env.STRIPE_AUTO_CREATE_LEADS
  if (perProviderFlag !== "true") return null

  const email = contact.email ?? null
  const phone = contact.phone ?? null

  // Fix A (idempotencia): sin NINGÚN identificador (customer id, email, teléfono)
  // no hay forma de deduplicar → cada payment.created/updated crearía un lead
  // nuevo. Mejor dejarlo SIN vincular (como hoy); se resuelve manualmente en
  // /admin/external-unlinked. Evita duplicados "sin contacto" por reintentos.
  if (!externalCustomerId && !email && !phone) return null

  // ── Marca destino: oferta mapeada (por ID exacto) o centinela 'unassigned' ──
  const mapMatch = await resolveOfferBrand(sb, provider, candidateKeys)
  let targetBrandId = mapMatch?.brandId ?? null
  if (!targetBrandId) {
    targetBrandId = await getUnassignedBrandId(sb)
    if (!targetBrandId) return null // SQL no corrido → defensivo, no rompe el webhook
  }

  // ── DRY-RUN: loguea qué crearía y NO inserta ────────────────────────────────
  const dryRun =
    provider === "square"
      ? process.env.SQUARE_ROUTING_DRYRUN === "true"
      : process.env.STRIPE_ROUTING_DRYRUN === "true"
  if (dryRun) {
    console.log(
      `[offer-routing] DRY-RUN ${provider}: crearía lead en brand=${targetBrandId} ` +
        `mapeado=${Boolean(mapMatch)} keys=${JSON.stringify(candidateKeys)} ` +
        `contacto=${JSON.stringify({ name: contact.name ?? null, email, phone })}`,
    )
    return null
  }

  // Nombre/apellido separados (Square ya da given_name/family_name). Fallback al
  // nombre completo si solo viene ese, o a teléfono/email como último recurso.
  const firstName =
    contact.firstName?.trim() || contact.name?.trim() || phone || email || `${provider} sin contacto`
  const lastName = contact.lastName?.trim() || null

  // ── Dedup Layer 1: por external customer id (idempotente re-runs) ────────────
  let leadId: string | null = null
  let created = false
  // Marca efectiva del registro externo: por defecto la target. Fix C: si reusamos
  // un lead que YA existe y vive en OTRA marca (mismo customer comprando en 2
  // clínicas de la cuenta compartida de Square), usamos SU marca real para NO
  // cruzar marcas en external_payments/appointments.
  let effectiveBrandId = targetBrandId
  if (externalCustomerId) {
    leadId = await findLeadByExternalId(sb, provider, externalCustomerId)
    if (leadId) {
      const { data: lr } = await sb
        .from("leads")
        .select("brand_id")
        .eq("id", leadId)
        .maybeSingle()
      const realBrand = (lr as { brand_id: string } | null)?.brand_id
      if (realBrand) effectiveBrandId = realBrand
    }
  }

  // ── Dedup Layer 2: por email/teléfono dentro de la marca destino ────────────
  if (!leadId) {
    const dupId = await findLeadByEmailOrPhone(sb, targetBrandId, email, phone)
    if (dupId) {
      leadId = dupId
      // Si trae customer id y el lead no tenía external_id, sellarlo (idempotencia futura).
      if (externalCustomerId) {
        const { data: leadRow } = await sb
          .from("leads")
          .select("external_id")
          .eq("id", dupId)
          .maybeSingle()
        if (leadRow && !(leadRow as { external_id: string | null }).external_id) {
          await sb
            .from("leads")
            .update({ external_id: externalCustomerId, external_provider: provider })
            .eq("id", dupId)
        }
      }
    }
  }

  // ── Layer 3: insertar lead nuevo ────────────────────────────────────────────
  if (!leadId) {
    const insertRow = {
      brand_id: targetBrandId,
      first_name: firstName,
      last_name: lastName,
      phone,
      email,
      address_line1: contact.address ?? null,
      status: "new",
      source: deriveLeadSource(provider, origin), // 'square'/'stripe'/'walk_in'
      external_id: externalCustomerId ?? null,
      external_provider: externalCustomerId ? provider : null,
      assigned_rep_id: null,
      notes: buildNotes(provider, mapMatch, origin, noteSuffix),
    }
    // `as any`: source puede ser 'square'/'stripe' (valores del enum agregados por
    // SQL) que aún no están en database.ts. Mismo patrón que meta-lead-ads.ts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (sb as any)
      .from("leads")
      .insert(insertRow)
      .select("id")
      .single()
    if (error) {
      // Violación del índice único parcial (provider, external_id) por carrera:
      // otro webhook creó el mismo lead. Re-buscar y reusar (idempotente).
      if (externalCustomerId) {
        const raced = await findLeadByExternalId(sb, provider, externalCustomerId)
        if (raced) {
          leadId = raced
        } else {
          console.warn(`[offer-routing] insert lead falló (${provider}): ${error.message}`)
          return null
        }
      } else {
        console.warn(`[offer-routing] insert lead falló (${provider}): ${error.message}`)
        return null
      }
    } else if (data) {
      leadId = (data as { id: string }).id
      created = true
    }
  }

  if (!leadId) return null

  // ── Push a Practice Better: SOLO si se creó Y la oferta era marca REAL ───────
  // findOrCreatePbRecord busca por email antes de crear (anti-duplicados, bug #2).
  if (created && mapMatch) {
    try {
      const { data: brandRow } = await sb
        .from("brands")
        .select("slug")
        .eq("id", targetBrandId)
        .maybeSingle()
      const brandSlug = (brandRow as { slug: string } | null)?.slug ?? null
      if (brandSlug && pbEnabledSlugs().has(brandSlug)) {
        await findOrCreatePbRecord(sb, {
          leadId,
          brandId: targetBrandId,
          firstName,
          lastName,
          email,
          phone,
          // Enriquecimiento (Fase 2): dirección + nota de pago. Gate propio para
          // poder apagar lo caro sin tocar el ruteo; default como antes (sin datos).
          address: process.env.PB_ENRICH_RECORDS === "true" ? (pbAddress ?? null) : null,
          notes: process.env.PB_ENRICH_RECORDS === "true" ? (pbNote ?? null) : null,
        })
      }
    } catch (e) {
      // Un fallo de PB NUNCA hace fallar el ruteo.
      console.warn(
        "[offer-routing] Practice Better push falló (no bloqueante):",
        e instanceof Error ? e.message : String(e),
      )
    }
  }

  return { leadId, brandId: effectiveBrandId }
}
