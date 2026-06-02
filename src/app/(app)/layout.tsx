import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { AppShell } from "@/components/layout/app-shell"
import type { Tables } from "@/types/database"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { countPendingActions } from "@/lib/agent/pending-actions"
import { createAdminClient } from "@/lib/supabase/admin"
import { getUnreadCount } from "./_actions/notifications"

type UserProfile = Pick<
  Tables<"users">,
  "id" | "name" | "role" | "email" | "avatar_url"
>

type BrandRow = {
  id: string
  slug: string
  name: string
  brand_color: string | null
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  // Profile
  const { data: profileRaw } = await supabase
    .from("users")
    .select("id, name, role, email, avatar_url")
    .eq("id", user.id)
    .single()

  const profile = profileRaw as UserProfile | null
  if (!profile) redirect("/login")

  // Brands via join
  const { data: brandsRaw } = await supabase
    .from("user_brands")
    .select("brands(id, slug, name, brand_color)")
    .eq("user_id", user.id)

  const brands: BrandRow[] = (brandsRaw ?? [])
    .flatMap((row) => {
      const b = (row as unknown as { brands: BrandRow | null }).brands
      return b ? [b] : []
    })

  // Lead count — reps: own; admin/manager: all active
  const baseLeadQuery = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .not("status", "in", "(sold,lost)")

  const leadQuery =
    profile.role === "rep"
      ? baseLeadQuery.eq("assigned_rep_id", user.id)
      : baseLeadQuery

  // Tasks + notifications in parallel
  // unreadCount incluye notifs reales sin read_at + virtuales (cuotas próximas/vencidas)
  const [{ count: leadCount }, taskResult, unreadCount] =
    await Promise.all([
      leadQuery,
      supabase
        .from("tasks")
        .select("priority")
        .eq("assigned_to", user.id)
        .eq("status", "open"),
      getUnreadCount(),
    ])

  const tasks = (taskResult.data ?? []) as Array<{ priority: string }>
  const taskCount = tasks.length
  const urgentTasks = tasks.some(
    (t) => t.priority === "urgent" || t.priority === "high"
  )

  // Shipping pending count (citas aprobadas sin shippear). Solo admin/manager.
  let shippingPendingCount = 0
  if (profile.role === "admin" || profile.role === "manager") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabase as any)
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("provider_approved", true)
      .is("shipped_at", null)
    shippingPendingCount = (count as number | null) ?? 0
  }

  // Pending agent-actions count (solo admin/manager ven la bandeja)
  let pendingCount = 0
  if (profile.role === "admin" || profile.role === "manager") {
    const cookieStore = await cookies()
    const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
    const brandId = brandSlug
      ? await getBrandIdBySlug(brandSlug, supabase as unknown as SupabaseClient<Database>)
      : null
    try {
      const admin = createAdminClient() as unknown as SupabaseClient<Database>
      pendingCount = await countPendingActions(admin, {
        brandId,
        userId: user.id,
        role: profile.role,
      })
    } catch (err) {
      console.error("[layout] countPendingActions:", err)
    }
  }

  return (
    <AppShell
      brands={brands}
      user={{
        name: profile.name,
        email: profile.email,
        role: profile.role,
        avatar_url: profile.avatar_url,
      }}
      leadCount={leadCount ?? 0}
      taskCount={taskCount}
      shippingPendingCount={shippingPendingCount}
      urgentTasks={urgentTasks}
      unreadCount={unreadCount}
      pendingCount={pendingCount}
    >
      {children}
    </AppShell>
  )
}
