"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"
import { assertNotProvider, getCurrentRole } from "@/lib/auth/role-guards"

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
  status: z.enum(["new", "contacted", "qualified", "appointment_set", "sold", "lost", "on_hold", "not_interested"]),
  source: z.enum(["inbound_call", "web_form", "referral", "whatsapp", "walk_in", "social", "facebook", "other"]).nullable(),
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
  assertNotProvider(role)

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

  if (profile?.role === "rep" || profile?.role === "provider") {
    throw new Error("Sin permiso para borrar leads")
  }

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
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const amount_cents = input.items.reduce((s, i) => s + i.line_total_cents, 0)
  const isPaid = input.payment_status === "paid"

  // Idempotencia: si existe una venta idéntica del mismo rep al mismo lead
  // por el mismo monto en los últimos 30s, devolver esa en lugar de crear duplicado.
  const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString()
  const { data: recent } = await supabase
    .from("sales")
    .select("id")
    .eq("lead_id", input.lead_id)
    .eq("rep_id", user.id)
    .eq("amount_cents", amount_cents)
    .gte("created_at", thirtySecondsAgo)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (recent?.id) {
    return recent.id
  }

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
  revalidatePath("/payments-due")

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
  sale_id: string | null
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
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
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
  revalidatePath("/payments-due")
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
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
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
  revalidatePath("/payments-due")
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
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
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
  revalidatePath("/payments-due")
}

// ── Update / Delete Sale (standalone) ────────────────────────────────────────

const UpdateSaleSchema = z.object({
  id: z.string().uuid(),
  lead_id: z.string().uuid(),
  amount_cents: z.number().int().min(0),
  payment_status: z.enum(["paid", "pending", "partial", "failed", "refunded"]),
  payment_method: z.enum(["cash", "card", "stripe"]),
  notes: z.string().nullable(),
})

export type UpdateSaleInput = z.infer<typeof UpdateSaleSchema>

export async function updateSale(raw: UpdateSaleInput) {
  const input = UpdateSaleSchema.parse(raw)
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // Bloquear edición de sales auto-generadas desde un payment plan (se manejan
  // desde el plan). Detectarlas por su sale_id presente en payment_plans.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: linkedPlan } = await sb
    .from("payment_plans")
    .select("id")
    .eq("sale_id", input.id)
    .maybeSingle()
  if (linkedPlan?.id) {
    throw new Error("Esta venta viene de un payment plan. Edítala desde el plan.")
  }

  const isPaid = input.payment_status === "paid"
  const { error } = await supabase
    .from("sales")
    .update({
      amount_cents: input.amount_cents,
      payment_status: input.payment_status,
      payment_method: input.payment_method,
      notes: input.notes,
      paid_at: isPaid ? new Date().toISOString() : null,
    })
    .eq("id", input.id)

  if (error) throw new Error(error.message)

  revalidatePath(`/leads/${input.lead_id}`)
  revalidatePath("/sales")
  revalidatePath("/dashboard")
}

export async function reassignSaleRep(
  saleId: string,
  newRepId: string,
  leadId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  if (role !== "admin" && role !== "manager") {
    return { ok: false, error: "Solo admin/manager pueden reasignar" }
  }
  const { error } = await supabase
    .from("sales")
    .update({ rep_id: newRepId })
    .eq("id", saleId)
  if (error) return { ok: false, error: error.message }
  if (leadId) revalidatePath(`/leads/${leadId}`)
  revalidatePath("/sales")
  revalidatePath("/dashboard")
  return { ok: true }
}

export async function deleteSale(saleId: string, leadId: string) {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: linkedPlan } = await sb
    .from("payment_plans")
    .select("id")
    .eq("sale_id", saleId)
    .maybeSingle()
  if (linkedPlan?.id) {
    throw new Error("Esta venta viene de un payment plan. Borra el plan para eliminarla.")
  }

  // Borrar sale_items primero
  await supabase.from("sale_items").delete().eq("sale_id", saleId)
  const { error } = await supabase.from("sales").delete().eq("id", saleId)
  if (error) throw new Error(error.message)

  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/sales")
  revalidatePath("/dashboard")
}

// ── Extend Payment Plan ───────────────────────────────────────────────────────

const ExtendPlanSchema = z.object({
  plan_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  installments: z
    .array(
      z.object({
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
        amount_cents: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(52),
})

export type ExtendPlanInput = z.infer<typeof ExtendPlanSchema>

/**
 * Agrega N cuotas adicionales al plan. Cada cuota nueva queda con su override
 * de due_date y amount_cents. Se incrementa installment_count y total_amount_cents
 * y se sincroniza la sale vinculada.
 */
export async function extendPaymentPlan(raw: ExtendPlanInput) {
  const input = ExtendPlanSchema.parse(raw)
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: plan } = await sb
    .from("payment_plans")
    .select("installment_count, total_amount_cents, installment_overrides, sale_id, first_due_date")
    .eq("id", input.plan_id)
    .single()

  if (!plan) throw new Error("Plan no encontrado")

  const currentCount = (plan.installment_count as number | null) ?? 0
  const overrides: Record<string, { due_date?: string; amount_cents?: number }> =
    (plan.installment_overrides as Record<string, { due_date?: string; amount_cents?: number }>) ?? {}

  for (let i = 0; i < input.installments.length; i++) {
    const seq = currentCount + i + 1
    overrides[String(seq)] = {
      due_date: input.installments[i].due_date,
      amount_cents: input.installments[i].amount_cents,
    }
  }

  const addCents = input.installments.reduce((s, x) => s + x.amount_cents, 0)
  const newCount = currentCount + input.installments.length
  const newTotal = (plan.total_amount_cents as number) + addCents

  // Si el plan no tenía schedule (count=0 / first_due_date null), inicializamos
  // first_due_date con la primera fecha de las cuotas nuevas para que el render
  // del schedule funcione. installment_amount_cents se mantiene como esté (los
  // overrides individuales dominan).
  const initSchedule =
    currentCount === 0
      ? {
          first_due_date: input.installments[0].due_date,
          frequency_days:
            input.installments.length > 1
              ? Math.max(
                  1,
                  Math.round(
                    (new Date(input.installments[1].due_date + "T12:00:00").getTime() -
                      new Date(input.installments[0].due_date + "T12:00:00").getTime()) /
                      (1000 * 60 * 60 * 24),
                  ),
                )
              : 7,
          installment_amount_cents: input.installments[0].amount_cents,
        }
      : {}

  const { error } = await sb
    .from("payment_plans")
    .update({
      installment_count: newCount,
      total_amount_cents: newTotal,
      installment_overrides: overrides,
      ...initSchedule,
    })
    .eq("id", input.plan_id)

  if (error) throw new Error(error.message)

  // Sincronizar sale vinculada
  if (plan.sale_id) {
    await sb.from("sales").update({ amount_cents: newTotal }).eq("id", plan.sale_id)
    await refreshPlanSaleStatus(supabase, input.plan_id)
  }

  revalidatePath(`/leads/${input.lead_id}`)
  revalidatePath("/sales")
  revalidatePath("/dashboard")
  revalidatePath("/payments-due")
}

export async function deletePaymentPlan(planId: string, leadId: string) {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
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
  revalidatePath("/payments-due")
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
    .select("amount_cents, paid_at")
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

  // Cuando el plan queda settled, el sale.paid_at refleja la fecha del ÚLTIMO
  // abono real (la que el rep escribió). Antes se usaba new Date(), lo que
  // ignoraba correcciones manuales de fecha al editar/agregar abonos.
  let salePaidAt: string | null = null
  if (newStatus === "paid") {
    const maxPaidAt = (abonos ?? [])
      .map((a: { paid_at: string }) => a.paid_at)
      .filter(Boolean)
      .sort()
      .at(-1)
    salePaidAt = maxPaidAt ?? new Date().toISOString()
  }

  await sb
    .from("sales")
    .update({
      payment_status: newStatus,
      paid_at: salePaidAt,
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
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
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
  revalidatePath("/payments-due")
}

const UpdateAbonoSchema = z.object({
  abono_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  amount_cents: z.number().int().min(1),
  paid_at: z.string().min(1),
  payment_method: z.string().min(1),
  notes: z.string().nullable(),
})

export type UpdateAbonoInput = z.infer<typeof UpdateAbonoSchema>

export async function updateAbono(raw: UpdateAbonoInput) {
  const input = UpdateAbonoSchema.parse(raw)
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Capturar plan_id antes para recalcular status del plan/sale
  const { data: abonoRow } = await sb
    .from("abonos")
    .select("plan_id")
    .eq("id", input.abono_id)
    .single()

  const { error } = await sb
    .from("abonos")
    .update({
      amount_cents: input.amount_cents,
      paid_at: input.paid_at,
      payment_method: input.payment_method,
      notes: input.notes,
    })
    .eq("id", input.abono_id)

  if (error) throw new Error(error.message)

  if (abonoRow?.plan_id) {
    await refreshPlanSaleStatus(supabase, abonoRow.plan_id as string)
  }

  revalidatePath(`/leads/${input.lead_id}`)
  revalidatePath("/sales")
  revalidatePath("/dashboard")
  revalidatePath("/payments-due")
}

export async function deleteAbono(abonoId: string, leadId: string) {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
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
  revalidatePath("/payments-due")
}

export async function fetchPaymentPlans(leadId: string): Promise<PaymentPlan[]> {
  const supabase = await typedClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("payment_plans")
    .select(`
      id,
      sale_id,
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
