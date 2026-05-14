"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { runReflection } from "@/lib/agent/reflection"
import { revalidatePath } from "next/cache"

type SB = SupabaseClient<Database>

export async function runReflectionNowAction() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const sb = supabase as unknown as SB
  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).single()
  if ((profile?.role ?? "rep") !== "admin") throw new Error("Solo admins")

  const cookieStore = await cookies()
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  // Usa service client para bypass RLS (reflection inserta en knowledge_patterns y self_reflection_runs)
  const service = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ) as unknown as SB

  const untilIso = new Date().toISOString()
  const sinceIso = new Date(Date.now() - 24 * 3600_000).toISOString()
  await runReflection(service, { brandId, sinceIso, untilIso })

  revalidatePath("/admin/insights")
  redirect("/admin/insights")
}
