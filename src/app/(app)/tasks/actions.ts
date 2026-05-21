"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"
import { assertNotProvider, getCurrentRole } from "@/lib/auth/role-guards"

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

const CreateTaskSchema = z.object({
  brand_id: z.string().uuid().nullable(),
  title: z.string().min(1),
  description: z.string().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  due_at: z.string().nullable(),
  assigned_to: z.string().uuid().nullable(),
  related_lead_id: z.string().uuid().nullable(),
})

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>

export async function createTask(raw: CreateTaskInput) {
  const input = CreateTaskSchema.parse(raw)
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { error } = await supabase.from("tasks").insert({
    brand_id: input.brand_id,
    title: input.title,
    description: input.description,
    priority: input.priority,
    due_at: input.due_at,
    assigned_to: input.assigned_to ?? user.id,
    related_lead_id: input.related_lead_id,
    status: "open",
    source: "manual",
  })
  if (error) throw new Error(error.message)
  revalidatePath("/tasks")
}

export async function updateTaskStatus(
  id: string,
  status: Database["public"]["Enums"]["task_status"]
) {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const completed_at = status === "done" ? new Date().toISOString() : null
  const { error } = await supabase
    .from("tasks")
    .update({ status, completed_at })
    .eq("id", id)
  if (error) throw new Error(error.message)
  revalidatePath("/tasks")
}

export async function reassignTaskAssignee(
  taskId: string,
  newAssigneeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  if (role !== "admin" && role !== "manager") {
    return { ok: false, error: "Solo admin/manager pueden reasignar" }
  }
  const { error } = await supabase
    .from("tasks")
    .update({ assigned_to: newAssigneeId })
    .eq("id", taskId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/tasks")
  revalidatePath("/dashboard")
  return { ok: true }
}

export async function fetchRepsForTasks() {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  if (profile?.role === "rep") return []

  const { data } = await supabase.from("users").select("id, name").eq("active", true).order("name")
  return (data ?? []) as { id: string; name: string }[]
}
