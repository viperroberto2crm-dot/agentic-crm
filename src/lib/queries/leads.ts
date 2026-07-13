import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { applyLeadSearch } from "./search"

type SB = SupabaseClient<Database>

export type LeadRow = {
  id: string
  first_name: string
  last_name: string | null
  phone: string
  email: string | null
  status: Database["public"]["Enums"]["lead_status"]
  source: Database["public"]["Enums"]["lead_source"] | null
  ai_score: number | null
  last_contacted_at: string | null
  created_at: string
  brand: { id: string; name: string; slug: string; brand_color: string | null } | null
  rep: { id: string; name: string } | null
}

export type LeadsFilters = {
  brandId?: string | null
  brandIds?: string[]   // "all companies" mode: strict allow-list of authorized brands
  status?: string | null
  source?: string | null
  search?: string | null
  repId?: string | null   // managers/admins only
  leadIds?: string[] | null  // explicit allow-list (used for provider scope)
  limit?: number
  offset?: number
}

export type LeadsResult = {
  leads: LeadRow[]
  total: number
}

export async function fetchLeads(
  sb: SB,
  userId: string,
  userRole: string,
  filters: LeadsFilters
): Promise<LeadsResult> {
  const limit = filters.limit ?? 50
  const offset = filters.offset ?? 0

  // "All companies" mode: an empty allow-list means the user has no authorized
  // brands — return nothing rather than falling back to an unfiltered query.
  if (filters.brandIds && filters.brandIds.length === 0) {
    return { leads: [], total: 0 }
  }

  let query = sb
    .from("leads")
    .select(
      `id, first_name, last_name, phone, email, status, source,
       ai_score, last_contacted_at, created_at,
       brand:brands!leads_brand_id_fkey(id, name, slug, brand_color),
       rep:users!leads_assigned_rep_id_fkey(id, name)`,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  // Reps only see their assigned leads
  if (userRole === "rep") {
    query = query.eq("assigned_rep_id", userId)
  } else if (filters.repId) {
    query = query.eq("assigned_rep_id", filters.repId)
  }

  // Providers see only leads that appear in the explicit allow-list
  // (leadIds is computed by the caller from appointments where rep_id = provider)
  if (filters.leadIds) {
    if (filters.leadIds.length === 0) {
      query = query.eq("id", "00000000-0000-0000-0000-000000000000")
    } else {
      query = query.in("id", filters.leadIds)
    }
  }

  // In "all companies" mode, strictly scope to the authorized brand ids.
  // This replaces the single-brand filter when a non-empty list is provided.
  if (filters.brandIds && filters.brandIds.length > 0) {
    query = query.in("brand_id", filters.brandIds)
  } else if (filters.brandId) {
    query = query.eq("brand_id", filters.brandId)
  }

  if (filters.status) {
    query = query.eq("status", filters.status as Database["public"]["Enums"]["lead_status"])
  }

  if (filters.source) {
    query = query.eq("source", filters.source as Database["public"]["Enums"]["lead_source"])
  }

  if (filters.search) {
    // Buscador unificado (applyLeadSearch en ./search): AND entre palabras, OR
    // entre campos; teléfono busca phone/phone_alt. Mismo helper en todos lados.
    query = applyLeadSearch(query, filters.search)
  }

  const { data, count, error } = await query

  if (error) {
    console.error("fetchLeads error:", error)
    return { leads: [], total: 0 }
  }

  const leads = (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string
      first_name: string
      last_name: string | null
      phone: string
      email: string | null
      status: Database["public"]["Enums"]["lead_status"]
      source: Database["public"]["Enums"]["lead_source"] | null
      ai_score: number | null
      last_contacted_at: string | null
      created_at: string
      brand: { id: string; name: string; slug: string; brand_color: string | null } | null
      rep: { id: string; name: string } | null
    }
    return {
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      phone: r.phone,
      email: r.email,
      status: r.status,
      source: r.source,
      ai_score: r.ai_score,
      last_contacted_at: r.last_contacted_at,
      created_at: r.created_at,
      brand: r.brand,
      rep: r.rep,
    } satisfies LeadRow
  })

  return { leads, total: count ?? 0 }
}

export async function fetchLeadById(sb: SB, id: string) {
  const { data, error } = await sb
    .from("leads")
    .select(
      `*, brand:brands!leads_brand_id_fkey(id, name, slug, brand_color),
       rep:users!leads_assigned_rep_id_fkey(id, name, avatar_url)`
    )
    .eq("id", id)
    .maybeSingle()

  if (error || !data) return null
  return data as unknown as {
    id: string
    brand_id: string
    first_name: string
    last_name: string | null
    phone: string
    phone_alt: string | null
    email: string | null
    status: Database["public"]["Enums"]["lead_status"]
    source: Database["public"]["Enums"]["lead_source"] | null
    assigned_rep_id: string | null
    notes: string | null
    address_line1: string | null
    address_line2: string | null
    city: string | null
    state: string | null
    zip: string | null
    custom_fields: unknown
    ai_score: number | null
    ai_score_reason: string | null
    last_contacted_at: string | null
    created_at: string
    updated_at: string
    brand: { id: string; name: string; slug: string; brand_color: string | null } | null
    rep: { id: string; name: string; avatar_url: string | null } | null
  }
}

export function daysAgo(dateStr: string | null): string {
  if (!dateStr) return "Nunca"
  const diff = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 86_400_000
  )
  if (diff === 0) return "Hoy"
  if (diff === 1) return "Ayer"
  return `Hace ${diff} días`
}
