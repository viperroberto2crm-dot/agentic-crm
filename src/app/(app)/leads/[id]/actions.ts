"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

// ── Update Lead ──────────────────────────────────────────────────────────────

const UpdateLeadSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().nullable(),
  phone: z.string().min(1),
  phone_alt: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(["new", "contacted", "qualified", "appointment_set", "sold", "lost", "on_hold"]),
  source: z.enum(["inbound_call", "web_form", "referral", "whatsapp", "walk_in", "social", "other"]).nullable(),
  assigned_rep_id: z.string().uuid().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  notes: z.string().nullable(),
})

export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>

export async function updateLead(id: string, raw: UpdateLeadInput) {
  const input = UpdateLeadSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // Reps can only edit their own leads; managers/admins can edit all
  const { data: profile } = await supabase
    .from("users").select("role").eq("id", user.id).single()
  const role = profile?.role ?? "rep"

  const query = supabase.from("leads").update(input).eq("id", id)
  const { error } = role === "rep"
    ? await query.eq("assigned_rep_id", user.id)
    : await query

  if (error) throw new Error(error.message)
  revalidatePath(`/leads/${id}`)
  revalidatePath("/leads")
}

// ── Delete Lead ──────────────────────────────────────────────────────────────

export async function deleteLead(id: string) {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: profile } = await supabase
    .from("users").select("role").eq("id", user.id).single()

  if (profile?.role === "rep") throw new Error("Sin permiso para borrar leads")

  const { error } = await supabase.from("leads").delete().eq("id", id)
  if (error) throw new Error(error.message)

  revalidatePath("/leads")
  revalidatePath("/dashboard")
  redirect("/leads")
}

const CartItemSchema = z.object({
  product_id: z.string().uuid().nullable(),
  product_name: z.string().min(1),
  product_category: z.string().min(1),
  cadence: z.string().min(1),
  billing_cycle_days: z.number().int().nullable(),
  quantity: z.number().int().min(1),
  unit_price_cents: z.number().int().min(0),
  discount_cents: z.number().int().min(0),
  line_total_cents: z.number().int().min(0),
  notes: z.string().nullable(),
})

const RegisterSaleSchema = z.object({
  lead_id: z.string().uuid(),
  brand_id: z.string().uuid(),
  payment_method: z.enum(["cash", "card", "stripe"]),
  payment_status: z.enum(["pending", "paid", "failed", "refunded", "partial"]),
  notes: z.string().nullable(),
  items: z.array(CartItemSchema).min(1),
})

export type RegisterSaleInput = z.infer<typeof RegisterSaleSchema>

export async function registerSale(raw: RegisterSaleInput) {
  const input = RegisterSaleSchema.parse(raw)

  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const amount_cents = input.items.reduce((s, i) => s + i.line_total_cents, 0)
  const isPaid = input.payment_status === "paid"

  // 1. Insert sale
  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .insert({
      brand_id: input.brand_id,
      lead_id: input.lead_id,
      rep_id: user.id,
      amount_cents,
      payment_method: input.payment_method,
      payment_status: input.payment_status,
      notes: input.notes,
      paid_at: isPaid ? new Date().toISOString() : null,
    })
    .select("id")
    .single()

  if (saleErr || !sale) throw new Error(saleErr?.message ?? "Error creando venta")

  // 2. Insert sale_items
  const itemsPayload = input.items.map((item) => ({
    sale_id: sale.id,
    product_id: item.product_id,
    product_name: item.product_name,
    product_category: item.product_category,
    cadence: item.cadence,
    quantity: item.quantity,
    unit_price_cents: item.unit_price_cents,
    discount_cents: item.discount_cents,
    line_total_cents: item.line_total_cents,
    notes: item.notes,
  }))

  const { error: itemsErr } = await supabase.from("sale_items").insert(itemsPayload)
  if (itemsErr) throw new Error(itemsErr.message)

  // 3. Auto-create subscriptions for non-one_time cadences
  const recurringItems = input.items.filter(
    (i) => i.cadence !== "one_time" && i.billing_cycle_days
  )

  if (recurringItems.length > 0) {
    const subsPayload = recurringItems.map((item) => {
      const nextBilling = new Date()
      nextBilling.setDate(nextBilling.getDate() + (item.billing_cycle_days ?? 30))
      return {
        brand_id: input.brand_id,
        lead_id: input.lead_id,
        product_id: item.product_id,
        initial_sale_id: sale.id,
        cadence: item.cadence,
        billing_cycle_days: item.billing_cycle_days!,
        amount_cents: item.line_total_cents,
        status: "active",
        started_at: new Date().toISOString(),
        next_billing_at: nextBilling.toISOString(),
      }
    })

    const { error: subsErr } = await supabase.from("subscriptions").insert(subsPayload)
    if (subsErr) throw new Error(subsErr.message)
  }

  revalidatePath(`/leads/${input.lead_id}`)
  revalidatePath("/dashboard")
  revalidatePath("/sales")

  return sale.id
}

// ── Payment Plans & Abonos ────────────────────────────────────────────────────

export type Abono = {
  id: string
  amount_cents: number
  paid_at: string
  payment_method: string
  notes: string | null
}

export type PaymentPlan = {
  id: string
  product_name: string
  total_amount_cents: number
  notes: string | null
  created_at: string
  abonos: Abono[]
}

const CreatePlanSchema = z.object({
  lead_id: z.string().uuid(),
  brand_id: z.string().uuid(),
  product_name: z.string().min(1),
  total_amount_cents: z.number().int().min(0),
  notes: z.string().nullable(),
})

export type CreatePlanInput = z.infer<typeof CreatePlanSchema>

export async function createPaymentPlan(raw: CreatePlanInput) {
  const input = CreatePlanSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("payment_plans")
    .insert({
      lead_id: input.lead_id,
      brand_id: input.brand_id,
      product_name: input.product_name,
      total_amount_cents: input.total_amount_cents,
      notes: input.notes,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error) throw new Error(error.message)
  revalidatePath(`/leads/${input.lead_id}`)
  return data.id as string
}

const AddAbonoSchema = z.object({
  plan_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  brand_id: z.string().uuid(),
  amount_cents: z.number().int().min(1),
  paid_at: z.string().min(1),
  payment_method: z.string().min(1),
  notes: z.string().nullable(),
})

export type AddAbonoInput = z.infer<typeof AddAbonoSchema>

export async function addAbono(raw: AddAbonoInput) {
  const input = AddAbonoSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("abonos")
    .insert({
      plan_id: input.plan_id,
      lead_id: input.lead_id,
      brand_id: input.brand_id,
      amount_cents: input.amount_cents,
      paid_at: input.paid_at,
      payment_method: input.payment_method,
      notes: input.notes,
      recorded_by: user.id,
    })

  if (error) throw new Error(error.message)
  revalidatePath(`/leads/${input.lead_id}`)
}

export async function deleteAbono(abonoId: string, leadId: string) {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("abonos")
    .delete()
    .eq("id", abonoId)

  if (error) throw new Error(error.message)
  revalidatePath(`/leads/${leadId}`)
}

export async function fetchPaymentPlans(leadId: string): Promise<PaymentPlan[]> {
  const supabase = await typedClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("payment_plans")
    .select(`
      id,
      product_name,
      total_amount_cents,
      notes,
      created_at,
      abonos (
        id,
        amount_cents,
        paid_at,
        payment_method,
        notes
      )
    `)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as PaymentPlan[]
}

export async function fetchProducts(brandId: string) {
  const supabase = await typedClient()

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, description, category, price_cents, display_price_cents, display_unit, cadence, billing_cycle_days, recurring, included_services, best_value, active"
    )
    .or(`brand_id.eq.${brandId},brand_id.is.null`)
    .eq("active", true)
    .order("sort_order")

  if (error) throw new Error(error.message)
  return data ?? []
}
