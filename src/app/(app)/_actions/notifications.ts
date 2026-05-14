"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"]

// Cast to bypass @supabase/ssr ↔ @supabase/supabase-js@2.46 generic mismatch
async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

export async function getNotifications(): Promise<NotificationRow[]> {
  const supabase = await typedClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20)

  return (data ?? []) as NotificationRow[]
}

export async function markAsRead(id: string): Promise<void> {
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
