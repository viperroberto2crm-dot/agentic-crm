"use server"

import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { getUpcomingInstallments } from "@/lib/queries/installments"

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"]

// Cast to bypass @supabase/ssr ↔ @supabase/supabase-js@2.46 generic mismatch
async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

const VIRTUAL_PREFIX = "virtual-inst-"

/** Ventana del bell para cuotas: vencidos ≤7 días + próximos 7 días. */
function bellWindow(): { fromIso: string; toIso: string; todayIso: string } {
  const now = new Date()
  const todayIso = now.toISOString().slice(0, 10)
  const fromDate = new Date(now)
  fromDate.setDate(fromDate.getDate() - 7)
  const toDate = new Date(now)
  toDate.setDate(toDate.getDate() + 7)
  return {
    fromIso: fromDate.toISOString().slice(0, 10),
    toIso: toDate.toISOString().slice(0, 10),
    todayIso,
  }
}

/**
 * Construye notificaciones virtuales para cuotas próximas/vencidas.
 * NO insertan en BD — el id lleva prefix `virtual-inst-` para distinguirlas.
 * markAsRead/markAllAsRead las ignoran (skip si id empieza con prefix).
 */
async function fetchVirtualInstallmentNotifs(opts: {
  sb: SupabaseClient<Database>
  userId: string
  role: string
}): Promise<NotificationRow[]> {
  const cookieStore = await cookies()
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, opts.sb) : null
  if (!brandId) return []

  const { fromIso, toIso, todayIso } = bellWindow()
  const installments = await getUpcomingInstallments({
    sb: opts.sb,
    userId: opts.userId,
    role: opts.role,
    brandId,
    fromIso,
    toIso,
  })

  return installments.map((inst): NotificationRow => {
    const isOverdue = inst.dueDate < todayIso
    const leadName = `${inst.leadFirstName} ${inst.leadLastName ?? ""}`.trim()
    const amount = `$${(inst.amountCents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
    const subject = isOverdue
      ? `Cobro vencido: ${amount} — ${leadName}`
      : `Cobro próximo: ${amount} — ${leadName}`
    const dueLabel = new Date(inst.dueDate + "T12:00:00").toLocaleDateString(
      "es-MX",
      { weekday: "short", month: "short", day: "numeric" }
    )
    const body = `${inst.productName} · Cuota ${inst.seq} · Vence ${dueLabel}`
    // sortKey: vencidos primero (más viejo = más urgente), luego próximos
    // created_at = dueDate (12:00 UTC) para que ordenen razonable junto a notifs reales
    const createdAt = new Date(inst.dueDate + "T12:00:00Z").toISOString()
    return {
      id: `${VIRTUAL_PREFIX}${inst.key}`,
      user_id: opts.userId,
      channel: "virtual",
      type: "installment_due",
      subject,
      body,
      related_lead_id: inst.leadId,
      related_call_id: null,
      related_appointment_id: null,
      related_sale_id: null,
      read_at: null,
      sent_at: createdAt,
      created_at: createdAt,
    }
  })
}

export async function getNotifications(): Promise<NotificationRow[]> {
  const supabase = await typedClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data: profileRaw } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single()
  const role = (profileRaw?.role ?? "rep") as string

  const [realRes, virtuals] = await Promise.all([
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    fetchVirtualInstallmentNotifs({ sb: supabase, userId: user.id, role }),
  ])

  const real = (realRes.data ?? []) as NotificationRow[]
  const merged = [...virtuals, ...real]
  // Sort: unread primero, luego por created_at desc
  merged.sort((a, b) => {
    const aUnread = a.read_at ? 1 : 0
    const bUnread = b.read_at ? 1 : 0
    if (aUnread !== bUnread) return aUnread - bUnread
    return b.created_at.localeCompare(a.created_at)
  })
  return merged.slice(0, 30)
}

/**
 * Conteo de no leídas para el badge del bell. Suma reales (sin read_at) +
 * virtuales (todas son "unread" — no se persisten).
 */
export async function getUnreadCount(): Promise<number> {
  const supabase = await typedClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 0

  const { data: profileRaw } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single()
  const role = (profileRaw?.role ?? "rep") as string

  const [realRes, virtuals] = await Promise.all([
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
    fetchVirtualInstallmentNotifs({ sb: supabase, userId: user.id, role }),
  ])
  return (realRes.count ?? 0) + virtuals.length
}

export async function markAsRead(id: string): Promise<void> {
  // Virtuales no se persisten — silent no-op
  if (id.startsWith(VIRTUAL_PREFIX)) return

  const supabase = await typedClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("read_at", null)

  revalidatePath("/", "layout")
}

export async function markAllAsRead(): Promise<void> {
  const supabase = await typedClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null)

  revalidatePath("/", "layout")
}
