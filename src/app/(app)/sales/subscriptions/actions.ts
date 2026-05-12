"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

const CancelSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().nullable(),
})

export async function cancelSubscription(raw: z.infer<typeof CancelSchema>) {
  const input = CancelSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  if (profile?.role === "rep") throw new Error("Sin permiso para cancelar suscripciones")

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_reason: input.reason,
    })
    .eq("id", input.id)

  if (error) throw new Error(error.message)
  revalidatePath("/sales/subscriptions")
  revalidatePath("/sales")
}
