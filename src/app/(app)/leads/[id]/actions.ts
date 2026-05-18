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
  phone: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length === 0 ? null : v),
    z.string().min(1).nullable()
  ),
  phone_alt: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(["new", "contacted", "qualified", "appointment_set", "sold", "lost", "on_hold"]),
  source: z.enum(["inbound_call", "web_form", "referral", "whatsapp", "walk_in", "social", "other"]).nullable(),
  assigned_rep_id: z.string().uuid().nullable(),
  address_line1: z.string().nullable(),
  address_line2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
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

export type InstallmentOverride = {
  due_date?: string
  amount_cents?: number
}

export type PaymentPlan = {
  id: string
  product_name: string
  total_amount_cents: number
  notes: string | null
  created_at: string
  installment_count: number | null
  installment_amount_cents: number | null
  frequency_days: number | null
  first_due_date: string | null
  installment_overrides: Record<string, InstallmentOverride>
  abonos: Abono[]
}

const CreatePlanSchema = z.object({
  lead_id: z.string().uuid(),
  brand_id: z.string().uuid(),
  product_name: z.string().min(1),
  total_amount_cents: z.number().int().min(0),
  notes: z.string().nullable(),
  installment_count: z.number().int().min(1).max(100).nullable().optional(),
  installment_amount_cents: z.number().int().min(0).nullable().optional(),
  frequency_days: z.number().int().min(1).max(365).nullable().optional(),
  first_due_date: z.string().nullable().optional(),
})

export type CreatePlanInput = z.infer<typeof CreatePlanSchema>

export async function createPaymentPlan(raw: CreatePlanInput) {
  const input = CreatePlanSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // 1) Crear la sale "partial" para que aparezca en /sales y KPIs
  const { data: saleRow, error: saleErr } = await supabase
    .from("sales")
    .insert({
      brand_id: input.brand_id,
      lead_id: input.lead_id,
      rep_id: user.id,
      amount_cents: input.total_amount_cents,
      payment_method: "cash",
      payment_status: "partial",
      notes: `Auto-generado desde Payment Plan: ${input.product_name}`,
    })
    .select("id")
    .single()

  if (saleErr || !saleRow) throw new Error(saleErr?.message ?? "Error creando venta vinculada")

  // 2) Crear el payment_plan vinculado a la sale
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("payment_plans")
    .insert({
      lead_id: input.lead_id,
      brand_id: input.brand_id,
      product_name: input.product_name,
      total_amount_cents: input.total_amount_cents,
      notes: input.notes,
      installment_count: input.installment_count ?? null,
      installment_amount_cents: input.installment_amount_cents ?? null,
      frequency_days: input.frequency_days ?? null,
      first_due_date: input.first_due_date ?? null,
      created_by: user.id,
      sale_id: saleRow.id,
    })
    .select("id")
    .single()

  if (error) throw new Error(error.message)
  revalidatePath(`/leads/${input.lead_id}`)
  revalidatePath("/sales")
  revalidatePath("/dashboard")
  return data.id as string
}

const UpdatePlanSchema = z.object({
  id: z.string().uuid(),
  lead_id: z.string().uuid(),
  product_name: z.string().min(1),
  total_amount_cents: z.number().int().min(0),
  notes: z.string().nullable(),
  installment_count: z.number().int().min(1).max(100).nullable(),
  installment_amount_cents: z.number().int().min(0).nullable(),
  frequency_days: z.number().int().min(1).max(365).nullable(),
  first_due_date: z.string().nullable(),
})

export type UpdatePlanInput = z.infer<typeof UpdatePlanSchema>

export async function updatePaymentPlan(raw: UpdatePlanInput) {
  const input = UpdatePlanSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: plan } = await sb
    .from("payment_plans")
    .select("sale_id")
    .eq("id", input.id)
    .single()

  const { error } = await sb
    .from("payment_plans")
    .update({
      product_name: input.product_name,
      total_amount_cents: input.total_amount_cents,
      notes: input.notes,
      installment_count: input.installment_count,
      installment_amount_cents: input.installment_amount_cents,
      frequency_days: input.frequency_days,
      first_due_date: input.first_due_date,
    })
    .eq("id", input.id)

  if (error) throw new Error(error.message)

  // Mantener sincronizado el monto de la venta vinculada
  if (plan?.sale_id) {
    await sb
      .from("sales")
      .update({ amount_cents: input.total_amount_cents })
      .eq("id", plan.sale_id)
    await refreshPlanSaleStatus(supabase, input.id)
  }

  revalidatePath(`/leads/${input.lead_id}`)
  revalidatePath("/sales")
  revalidatePath("/dashboard")
}

const UpdateInstallmentSchema = z.object({
  plan_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  sequence: z.number().int().min(1),
  due_date: z.string().nullable(),     // null → quita override de fecha
  amount_cents: z.number().int().min(0).nullable(),  // null → quita override de monto
})

export type UpdateInstallmentInput = z.infer<typeof UpdateInstallmentSchema>

export async function updateInstallmentOverride(raw: UpdateInstallmentInput) {
  const input = UpdateInstallmentSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: plan } = await sb
    .from("payment_plans")
    .select("installment_overrides")
    .eq("id", input.plan_id)
    .single()

  const overrides: Record<string, { due_date?: string; amount_cents?: number }> =
    (plan?.installment_overrides as Record<string, { due_date?: string; amount_cents?: number }>) ?? {}

  const key = String(input.sequence)
  const next: { due_date?: string; amount_cents?: number } = { ...(overrides[key] ?? {}) }

  if (input.due_date) next.due_date = input.due_date
  else delete next.due_date

  if (input.amount_cents != null) next.amount_cents = input.amount_cents
  else delete next.amount_cents

  // Si no quedan keys en este override, removerlo
  if (Object.keys(next).length === 0) delete overrides[key]
  else overrides[key] = next

  const { error } = await sb
    .from("payment_plans")
    .update({ installment_overrides: overrides })
    .eq("id", input.plan_id)

  if (error) throw new Error(error.message)

  revalidatePath(`/leads/${input.lead_id}`)
}

export async function deletePaymentPlan(planId: string, leadId: string) {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  // Get linked sale_id so we can clean it up too
  const { data: plan } = await sb
    .from("payment_plans")
    .select("sale_id")
    .eq("id", planId)
    .single()

  // Delete abonos first (CASCADE may or may not be set)
  await sb.from("abonos").delete().eq("plan_id", planId)
  // Delete the plan
  const { error } = await sb.from("payment_plans").delete().eq("id", planId)
  if (error) throw new Error(error.message)

  // Borrar la sale auto-generada vinculada
  if (plan?.sale_id) {
    await sb.from("sale_items").delete().eq("sale_id", plan.sale_id)
    await sb.from("sales").delete().eq("id", plan.sale_id)
  }

  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/sales")
  revalidatePath("/dashboard")
}

async function refreshPlanSaleStatus(
  supabase: SupabaseClient<Database>,
  planId: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: plan } = await sb
    .from("payment_plans")
    .select("sale_id, total_amount_cents")
    .eq("id", planId)
    .single()

  if (!plan?.sale_id) return

  const { data: abonos } = await sb
    .from("abonos")
    .select("amount_cents")
    .eq("plan_id", planId)

  const paid = (abonos ?? []).reduce(
    (s: number, a: { amount_cents: number }) => s + a.amount_cents,
    0,
  )
  const total = plan.total_amount_cents as number

  let newStatus: "pending" | "partial" | "paid"
  if (paid <= 0) newStatus = "pending"
  else if (paid >= total) newStatus = "paid"
  else newStatus = "partial"

  await sb
    .from("sales")
    .update({
      payment_status: newStatus,
      paid_at: newStatus === "paid" ? new Date().toISOString() : null,
    })
    .eq("id", plan.sale_id)
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

  await refreshPlanSaleStatus(supabase, input.plan_id)

  revalidatePath(`/leads/${input.lead_id}`)
  revalidatePath("/sales")
  revalidatePath("/dashboard")
}

export async function deleteAbono(abonoId: string, leadId: string) {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Capturar plan_id antes del delete para poder recalcular
  const { data: abonoRow } = await sb
    .from("abonos")
    .select("plan_id")
    .eq("id", abonoId)
    .single()

  const { error } = await sb
    .from("abonos")
    .delete()
    .eq("id", abonoId)

  if (error) throw new Error(error.message)

  if (abonoRow?.plan_id) {
    await refreshPlanSaleStatus(supabase, abonoRow.plan_id as string)
  }

  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/sales")
  revalidatePath("/dashboard")
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
      installment_count,
      installment_amount_cents,
      frequency_days,
      first_due_date,
      installment_overrides,
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
  // Normalizar installment_overrides en caso de null/undefined
  return (data ?? []).map((p: PaymentPlan) => ({
    ...p,
    installment_overrides: p.installment_overrides ?? {},
  })) as PaymentPlan[]
}

export async function fetchProducts(brandId: string) {
  const supabase = await typedClient()

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, description, category, price_cents, display_price_cents, display_unit, cadence, billing_cycle_days, recurring, included_services, best_value, active"
    )
    .eq("brand_id", brandId)
    .eq("active", true)
    .order("sort_order")

  if (error) throw new Error(error.message)
  return data ?? []
}
