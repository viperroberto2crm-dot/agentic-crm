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
  createdFrom?: string   // UTC ISO inclusive (rango de fecha por created_at)
  createdTo?: string     // UTC ISO exclusivo (fin del rango, exclusivo)
  limit?: number
  offset?: number
}

export type LeadsResult = {
  leads: LeadRow[]
  total: number
}

const LEAD_SELECT = `id, first_name, last_name, phone, email, status, source,
       ai_score, last_contacted_at, created_at,
       brand:brands!leads_brand_id_fkey(id, name, slug, brand_color),
       rep:users!leads_assigned_rep_id_fkey(id, name)`

function mapLeadRow(row: unknown): LeadRow {
  const r = row as {
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
}

/**
 * Aplica los filtros de la lista (rol/allow-list/marca/status/source/fecha/
 * búsqueda) a una consulta ya construida. UN solo lugar → fetchLeads y
 * fetchLeadsByActivity filtran idéntico (sin divergencia).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyLeadFilters(query: any, userId: string, userRole: string, filters: LeadsFilters): any {
  // Reps solo ven sus leads asignados.
  if (userRole === "rep") query = query.eq("assigned_rep_id", userId)
  else if (filters.repId) query = query.eq("assigned_rep_id", filters.repId)

  // Allow-list explícita (scope de provider). Vacía → nada.
  if (filters.leadIds) {
    if (filters.leadIds.length === 0) query = query.eq("id", "00000000-0000-0000-0000-000000000000")
    else query = query.in("id", filters.leadIds)
  }

  // Marca (modo "todas las compañías" acota a las autorizadas).
  if (filters.brandIds && filters.brandIds.length > 0) query = query.in("brand_id", filters.brandIds)
  else if (filters.brandId) query = query.eq("brand_id", filters.brandId)

  if (filters.status) query = query.eq("status", filters.status)
  if (filters.source) query = query.eq("source", filters.source)
  if (filters.createdFrom) query = query.gte("created_at", filters.createdFrom)
  if (filters.createdTo) query = query.lt("created_at", filters.createdTo)
  if (filters.search) query = applyLeadSearch(query, filters.search)
  return query
}

export async function fetchLeads(
  sb: SB,
  userId: string,
  userRole: string,
  filters: LeadsFilters
): Promise<LeadsResult> {
  const limit = filters.limit ?? 50
  const offset = filters.offset ?? 0
  if (filters.brandIds && filters.brandIds.length === 0) return { leads: [], total: 0 }

  let query = sb
    .from("leads")
    .select(LEAD_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true }) // desempate estable en paginación (Fable #4)
    .range(offset, offset + limit - 1)
  query = applyLeadFilters(query, userId, userRole, filters)

  const { data, count, error } = await query
  if (error) {
    console.error("fetchLeads error:", error)
    return { leads: [], total: 0 }
  }
  return { leads: (data ?? []).map(mapLeadRow), total: count ?? 0 }
}

/**
 * Como fetchLeads pero además exige que el paciente tenga ACTIVIDAD en el periodo
 * (activeSet). Se resuelve en el SERVIDOR, sin `.in()` gigante ni el tope de 1000
 * de Supabase (evita el "0 pacientes" falso de Fable #1/#2):
 *   1) trae TODOS los ids que cumplen los filtros (paginado, ordenado desc);
 *   2) intersecta con activeSet en memoria (preserva el orden);
 *   3) trae solo las filas de la página (≤limit ids → `.in()` chico y seguro).
 */
export async function fetchLeadsByActivity(
  sb: SB,
  userId: string,
  userRole: string,
  filters: LeadsFilters,
  activeSet: Set<string>,
): Promise<LeadsResult> {
  const limit = filters.limit ?? 50
  const offset = filters.offset ?? 0
  if (filters.brandIds && filters.brandIds.length === 0) return { leads: [], total: 0 }
  if (activeSet.size === 0) return { leads: [], total: 0 }

  // 1) Todos los ids que cumplen los filtros, ordenados created_at desc (paginado).
  const PAGE = 1000
  const ordered: string[] = []
  for (let from = 0; from < 200_000; from += PAGE) {
    // order("id") de desempate → paginación estable aunque created_at empate.
    let idq = sb.from("leads").select("id")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    idq = applyLeadFilters(idq, userId, userRole, filters)
    const { data, error } = await idq
    if (error) {
      console.error("fetchLeadsByActivity ids error:", error)
      return { leads: [], total: 0 }
    }
    const rows = (data ?? []) as { id: string }[]
    for (const r of rows) ordered.push(r.id)
    if (rows.length < PAGE) break
  }

  // 2) Intersecta con la actividad (preserva el orden).
  const matched = ordered.filter((id) => activeSet.has(id))
  const total = matched.length
  const pageIds = matched.slice(offset, offset + limit)
  if (pageIds.length === 0) return { leads: [], total }

  // 3) Filas completas de la página (≤limit ids → `.in()` seguro).
  const { data, error } = await sb.from("leads").select(LEAD_SELECT).in("id", pageIds)
  if (error) {
    console.error("fetchLeadsByActivity rows error:", error)
    return { leads: [], total }
  }
  const byId = new Map<string, LeadRow>()
  for (const row of data ?? []) {
    const m = mapLeadRow(row)
    byId.set(m.id, m)
  }
  const leads = pageIds
    .map((id) => byId.get(id))
    .filter((x): x is LeadRow => Boolean(x))
  return { leads, total }
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
