"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"
import QRCode from "qrcode"
import { assertNotProvider, getCurrentRole } from "@/lib/auth/role-guards"
import { normalizeToE164 } from "@/lib/integrations/800com"
import { createCheckoutSessionForLead, createStripeCustomCheckout } from "@/lib/integrations/stripe-checkout"
import { createSquarePaymentLinkForLead, createSquareCustomLink } from "@/lib/integrations/square-checkout"
import { sendTwilioSms } from "@/lib/integrations/twilio"
import { getConnectionSecret } from "@/lib/integrations/connections"
import { resolveBrandTwilioFrom, resolveBrandByTwilioNumber } from "@/lib/integrations/brand-numbers"
import { MissingPbCredentialsError } from "@/lib/integrations/practice-better"
import { findOrCreatePbRecord } from "@/lib/integrations/pb-dedup"

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

// ── Update Lead ──────────────────────────────────────────────────────────────

const UpdateLeadSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().nullable(),
  phone: z.preprocess(
    (v) => {
      if (typeof v !== "string") return v
      const t = v.trim()
      return t ? normalizeToE164(t) || t : null
    },
    z.string().min(1).nullable()
  ),
  phone_alt: z
    .string()
    .nullable()
    .transform((v) => (v && v.trim() ? normalizeToE164(v.trim()) || v.trim() : v)),
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

  // Un rep NO puede reasignar el lead a otro (la RLS controla QUÉ fila edita,
  // no QUÉ valores; with_check es NULL). Quitamos assigned_rep_id del payload
  // para reps; admin/manager sí pueden reasignar.
  const updatePayload: UpdateLeadInput = { ...input }
  if (role === "rep") {
    delete (updatePayload as Partial<UpdateLeadInput>).assigned_rep_id
  }

  const query = supabase.from("leads").update(updatePayload).eq("id", id)
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
  payment_method: z.enum(["cash", "card", "stripe", "zelle"]),
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

  // Asignar la sale al REP DEL LEAD, no al user que la registra (admin/manager
  // suelen registrar ventas de leads que pertenecen a otros reps). Si el lead
  // no tiene rep asignado, fallback al user actual. El admin puede reasignar
  // después con el rep picker inline en /sales.
  const { data: leadRow } = await supabase
    .from("leads")
    .select("assigned_rep_id")
    .eq("id", input.lead_id)
    .maybeSingle()
  const saleRepId = leadRow?.assigned_rep_id ?? user.id

  // Idempotencia: si existe una venta idéntica del mismo rep al mismo lead
  // por el mismo monto en los últimos 30s, devolver esa en lugar de crear duplicado.
  const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString()
  const { data: recent } = await supabase
    .from("sales")
    .select("id")
    .eq("lead_id", input.lead_id)
    .eq("rep_id", saleRepId)
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
      rep_id: saleRepId,
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
  deleted?: boolean
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

  // Asignar la sale al REP DEL LEAD (igual que registerSale). Admin/manager
  // que crea un plan para lead ajeno NO debe quedarse con la sale.
  const { data: leadRow } = await supabase
    .from("leads")
    .select("assigned_rep_id")
    .eq("id", input.lead_id)
    .maybeSingle()
  const saleRepId = leadRow?.assigned_rep_id ?? user.id

  // 1) Crear la sale "partial" para que aparezca en /sales y KPIs
  const { data: saleRow, error: saleErr } = await supabase
    .from("sales")
    .insert({
      brand_id: input.brand_id,
      lead_id: input.lead_id,
      rep_id: saleRepId,
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

// ── Delete single installment ────────────────────────────────────────────────

const DeleteInstallmentSchema = z.object({
  plan_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  sequence: z.number().int().min(1),
})

export async function deleteInstallment(
  raw: z.infer<typeof DeleteInstallmentSchema>,
) {
  const input = DeleteInstallmentSchema.parse(raw)
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: plan } = await sb
    .from("payment_plans")
    .select("installment_amount_cents, total_amount_cents, installment_overrides")
    .eq("id", input.plan_id)
    .single()

  if (!plan) throw new Error("Plan no encontrado")

  const overrides: Record<string, InstallmentOverride> =
    (plan.installment_overrides as Record<string, InstallmentOverride>) ?? {}

  const key = String(input.sequence)
  const existing = overrides[key] ?? {}
  // Restar el monto de esta cuota del total esperado, para que el balance
  // siga consistente. Usa el override de monto si existe, sino el monto base.
  const amountToSubtract =
    existing.amount_cents ?? (plan.installment_amount_cents as number | null) ?? 0

  overrides[key] = { ...existing, deleted: true }

  const newTotal = Math.max(
    0,
    ((plan.total_amount_cents as number | null) ?? 0) - amountToSubtract,
  )

  const { error } = await sb
    .from("payment_plans")
    .update({
      installment_overrides: overrides,
      total_amount_cents: newTotal,
    })
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
  payment_method: z.enum(["cash", "card", "stripe", "zelle"]),
  notes: z.string().nullable(),
  // Fecha de pago opcional. Si viene como YYYY-MM-DD el rep la corrigió manualmente.
  // Si undefined: usar comportamiento anterior (auto-now si paid, null si no).
  paid_at: z.string().optional(),
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
  // Resolución de paid_at:
  //   - Si el rep envió fecha explícita (YYYY-MM-DD) → usar esa al mediodía UTC
  //   - Si no envió y status=paid → conservar el comportamiento anterior (now)
  //   - Si no envió y status!=paid → null (no pagado)
  const paidAtValue = input.paid_at
    ? new Date(input.paid_at + "T12:00:00Z").toISOString()
    : isPaid
      ? new Date().toISOString()
      : null

  const { error } = await supabase
    .from("sales")
    .update({
      amount_cents: input.amount_cents,
      payment_status: input.payment_status,
      payment_method: input.payment_method,
      notes: input.notes,
      paid_at: paidAtValue,
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

  // Un rep solo puede borrar SUS propias ventas; admin/manager todas
  // (mismo patrón que updateLead: scoping por dueño para reps)
  if (role === "rep") {
    const { data: sale } = await supabase
      .from("sales")
      .select("rep_id")
      .eq("id", saleId)
      .maybeSingle()
    if (!sale || sale.rep_id !== user.id) {
      throw new Error("Sin permiso para borrar esta venta")
    }
  }

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
    // abonos.paid_at es date-only ("2026-07-16"). Guardarlo crudo en el timestamptz
    // sale.paid_at lo castea a medianoche UTC = 5 PM PT del día ANTERIOR, corriendo
    // el conteo del día en las vistas PT. Anclamos a mediodía UTC (mismo día PT),
    // igual que el path de edición manual de abonos.
    salePaidAt = maxPaidAt
      ? `${maxPaidAt.slice(0, 10)}T12:00:00Z`
      : new Date().toISOString()
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

// ── Practice Better: crear paciente manualmente desde el perfil del lead ──────
// Rep/manager/admin pueden mandar un lead a Practice Better. No-bloqueante:
// devuelve {ok,error} en vez de lanzar, para que el botón muestre el error.
export async function sendLeadToPracticeBetter(
  leadId: string,
): Promise<{ ok: boolean; error?: string; alreadyLinked?: boolean }> {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role) // rep/manager/admin permitidos
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "No autorizado" }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: lead } = await sb
    .from("leads")
    .select("id, brand_id, first_name, last_name, email, pb_record_id, assigned_rep_id")
    .eq("id", leadId)
    .maybeSingle()
  if (!lead) return { ok: false, error: "Lead no encontrado" }
  // Un rep solo puede mandar a PB SUS propios leads (no depender solo de RLS)
  if (role === "rep" && lead.assigned_rep_id !== user.id) {
    return { ok: false, error: "Sin permiso para este lead" }
  }
  if (lead.pb_record_id) return { ok: true, alreadyLinked: true }

  // Practice Better REQUIERE email para crear un paciente. Validamos antes
  // de llamar para mostrar un mensaje claro en vez del error técnico de PB.
  const leadEmail = (lead.email ?? "").trim()
  if (!leadEmail) {
    return {
      ok: false,
      error: "Este lead no tiene email. Agrégale un email primero para poder crear el paciente en Practice Better.",
    }
  }

  // PB exige firstName Y lastName. Si el lead no tiene apellido, partimos el
  // nombre completo; si aun así no hay apellido, usamos un guion para cumplir.
  let firstName = (lead.first_name ?? "").trim() || "Paciente"
  let lastName = (lead.last_name ?? "").trim()
  if (!lastName && firstName.includes(" ")) {
    const parts = firstName.split(/\s+/)
    firstName = parts[0]
    lastName = parts.slice(1).join(" ")
  }
  if (!lastName) lastName = "—"

  try {
    // Busca por email antes de crear (anti-duplicados, bug #2). Hace el vínculo
    // condicional internamente; devuelve el estado para mapear el mensaje.
    const result = await findOrCreatePbRecord(sb, {
      leadId,
      brandId: lead.brand_id,
      firstName,
      lastName,
      email: leadEmail,
    })

    if (result.linked) {
      revalidatePath(`/leads/${leadId}`)
      return { ok: true }
    }

    switch (result.skipped) {
      case "lost_race":
        // Otro proceso vinculó el record en paralelo: el lead ya quedó ligado.
        revalidatePath(`/leads/${leadId}`)
        return { ok: true }
      case "already_linked":
        return {
          ok: false,
          error:
            "Ya existe un paciente con ese email en Practice Better, vinculado a otro lead de esta clínica. No se creó un duplicado.",
        }
      case "cross_brand":
        return {
          ok: false,
          error:
            "Ya existe un paciente con ese email en Practice Better bajo otra clínica. Revísalo antes de duplicar.",
        }
      case "no_id":
        return {
          ok: false,
          error: "Practice Better no devolvió un id. No reintentes; el polling lo vinculará por email.",
        }
      default:
        return { ok: false, error: "No se pudo crear el paciente en Practice Better." }
    }
  } catch (e) {
    if (e instanceof MissingPbCredentialsError) {
      return { ok: false, error: "Practice Better no está configurado" }
    }
    return { ok: false, error: e instanceof Error ? e.message : "Error al crear en Practice Better" }
  }
}

// ── Cobrar desde el CRM (Stripe) ─────────────────────────────────────────────
// El vendedor genera un link de cobro amarrado al lead. El pago vuelve por el
// webhook y se vincula solo (metadata.lead_id). NO escribe en `sales`.

/**
 * ¿El usuario es miembro de la marca? Admin siempre; los demás deben tener fila
 * en user_brands. Evita que un rep de la clínica A enumere ofertas o cobre a
 * nombre de la clínica B pasando su UUID directo a la server action.
 */
async function assertBrandMember(
  sb: SupabaseClient<Database>,
  userId: string,
  role: string,
  brandId: string,
): Promise<boolean> {
  if (role === "admin") return true
  const { data } = await sb
    .from("user_brands")
    .select("brand_id")
    .eq("user_id", userId)
    .eq("brand_id", brandId)
    .maybeSingle()
  return !!data
}

export type ChargeProvider = "stripe" | "square"
export type BrandOffer = {
  offer_key: string
  offer_label: string
  provider: ChargeProvider
}

/**
 * Lista las ofertas (Stripe + Square) mapeadas a una marca en Configuración →
 * Ofertas. El vendedor elige una; el provider viaja con la oferta.
 */
export async function listBrandOffers(
  brandId: string,
): Promise<{ ok: true; offers: BrandOffer[] } | { ok: false; error: string }> {
  try {
    if (!z.string().uuid().safeParse(brandId).success) {
      return { ok: false, error: "Marca inválida" }
    }
    const sb = await typedClient()
    const { userId, role } = await getCurrentRole(sb)
    assertNotProvider(role)
    if (!(await assertBrandMember(sb, userId, role, brandId))) {
      return { ok: false, error: "Sin acceso a esta marca." }
    }

    // Lectura con admin client (offer_brand_map es admin-only vía RLS); scoped
    // explícitamente por marca — solo devuelve keys + etiquetas de esa marca.
    const admin = createAdminClient() as unknown as SupabaseClient<Database>
    const { data, error } = await admin
      .from("offer_brand_map")
      .select("offer_key, offer_label, provider")
      .in("provider", ["stripe", "square"])
      .eq("brand_id", brandId)
      .eq("active", true)
      .order("offer_label", { ascending: true })

    if (error) {
      console.error("[listBrandOffers]", error.message)
      return { ok: false, error: "No se pudieron cargar las ofertas." }
    }
    const offers: BrandOffer[] = (data ?? []).map((r) => ({
      offer_key: r.offer_key,
      offer_label: (r.offer_label && r.offer_label.trim()) || r.offer_key,
      provider: (r.provider === "square" ? "square" : "stripe") as ChargeProvider,
    }))
    return { ok: true, offers }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error al cargar ofertas" }
  }
}

const ChargeLinkSchema = z.object({
  lead_id: z.string().uuid(),
  brand_id: z.string().uuid(),
  offer_key: z.string().min(1),
  provider: z.enum(["stripe", "square"]),
})
export type ChargeLinkInput = z.infer<typeof ChargeLinkSchema>

/** Crea un link de cobro (Stripe o Square) para el lead y devuelve link + QR. */
export async function createChargeLink(
  raw: ChargeLinkInput,
): Promise<
  { ok: true; url: string; qrDataUrl: string } | { ok: false; error: string }
> {
  try {
    const input = ChargeLinkSchema.parse(raw)
    const sb = await typedClient()
    const { userId, role } = await getCurrentRole(sb)
    assertNotProvider(role)
    if (!(await assertBrandMember(sb, userId, role, input.brand_id))) {
      return { ok: false, error: "Sin acceso a esta marca." }
    }

    const admin = createAdminClient() as unknown as SupabaseClient<Database>

    // 1) La oferta debe pertenecer a la marca Y al provider (no cobrar a nombre
    //    de otra clínica ni cruzar el key de un provider al otro).
    const { data: offer } = await admin
      .from("offer_brand_map")
      .select("offer_key")
      .eq("provider", input.provider)
      .eq("brand_id", input.brand_id)
      .eq("offer_key", input.offer_key)
      .eq("active", true)
      .maybeSingle()
    if (!offer) {
      return { ok: false, error: "La oferta no está disponible para esta marca." }
    }

    // 2) El lead debe existir y pertenecer a la misma marca. Tomamos su email.
    const { data: lead } = await sb
      .from("leads")
      .select("email, brand_id")
      .eq("id", input.lead_id)
      .single()
    if (!lead || lead.brand_id !== input.brand_id) {
      return { ok: false, error: "El paciente no es válido para esta marca." }
    }

    // 3) Base URL absoluta (mismo patrón que intake).
    const h = await headers()
    const host = h.get("host")
    if (!host) return { ok: false, error: "No se pudo determinar la URL del sitio." }
    const proto = h.get("x-forwarded-proto") ?? "https"
    const baseUrl = `${proto}://${host}`

    // 4) Crear el link de cobro con el provider correcto (lleva lead_id/brand_id).
    const link =
      input.provider === "square"
        ? await createSquarePaymentLinkForLead({
            variationId: input.offer_key,
            leadId: input.lead_id,
            brandId: input.brand_id,
            baseUrl,
          })
        : await createCheckoutSessionForLead({
            priceId: input.offer_key,
            leadId: input.lead_id,
            brandId: input.brand_id,
            email: lead.email,
            baseUrl,
          })
    if (!link.ok) return { ok: false, error: link.error }

    // 5) QR del link para que el paciente escanee y pague en su teléfono.
    const qrDataUrl = await QRCode.toDataURL(link.url, { margin: 1, width: 220 })

    return { ok: true, url: link.url, qrDataUrl }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Datos inválidos" }
    }
    return { ok: false, error: e instanceof Error ? e.message : "Error al crear el cobro" }
  }
}

const CustomChargeSchema = z.object({
  lead_id: z.string().uuid(),
  brand_id: z.string().uuid(),
  provider: z.enum(["stripe", "square"]),
  // $1.00 a $20,000. Entero en centavos.
  amount_cents: z.number().int().min(100).max(2_000_000),
  description: z.string().trim().min(1, "Escribe el concepto").max(120),
})
export type CustomChargeInput = z.infer<typeof CustomChargeSchema>

/**
 * Cobro por un MONTO PERSONALIZADO (un producto/concepto que NO es una oferta
 * mapeada). El vendedor teclea concepto + monto. Igual que createChargeLink: no
 * escribe en `sales`; el dinero lo registra el webhook en external_payments.
 */
export async function createCustomChargeLink(
  raw: CustomChargeInput,
): Promise<
  { ok: true; url: string; qrDataUrl: string } | { ok: false; error: string }
> {
  try {
    const input = CustomChargeSchema.parse(raw)
    const sb = await typedClient()
    const { userId, role } = await getCurrentRole(sb)
    assertNotProvider(role)
    if (!(await assertBrandMember(sb, userId, role, input.brand_id))) {
      return { ok: false, error: "Sin acceso a esta marca." }
    }

    // El lead debe existir y pertenecer a la marca. Tomamos su email (Stripe).
    const { data: lead } = await sb
      .from("leads")
      .select("email, brand_id")
      .eq("id", input.lead_id)
      .single()
    if (!lead || lead.brand_id !== input.brand_id) {
      return { ok: false, error: "El paciente no es válido para esta marca." }
    }

    const h = await headers()
    const host = h.get("host")
    if (!host) return { ok: false, error: "No se pudo determinar la URL del sitio." }
    const proto = h.get("x-forwarded-proto") ?? "https"
    const baseUrl = `${proto}://${host}`

    const link =
      input.provider === "square"
        ? await createSquareCustomLink({
            amountCents: input.amount_cents,
            description: input.description,
            leadId: input.lead_id,
            brandId: input.brand_id,
            baseUrl,
          })
        : await createStripeCustomCheckout({
            amountCents: input.amount_cents,
            description: input.description,
            leadId: input.lead_id,
            brandId: input.brand_id,
            email: lead.email,
            baseUrl,
          })
    if (!link.ok) return { ok: false, error: link.error }

    const qrDataUrl = await QRCode.toDataURL(link.url, { margin: 1, width: 220 })
    return { ok: true, url: link.url, qrDataUrl }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Datos inválidos" }
    }
    return { ok: false, error: e instanceof Error ? e.message : "Error al crear el cobro" }
  }
}

// ── Enviar SMS al paciente (Twilio) ──────────────────────────────────────────

const SendSmsSchema = z.object({
  lead_id: z.string().uuid(),
  brand_id: z.string().uuid(),
  body: z.string().trim().min(1, "Escribe un mensaje").max(1000),
})
export type SendSmsInput = z.infer<typeof SendSmsSchema>

/**
 * Envía un SMS al paciente vía Twilio y lo registra en `messages`. Guard de rol +
 * membresía de marca; respeta el opt-out (STOP). Usa las credenciales guardadas
 * (cifradas) de Twilio. No escribe en `sales`.
 */
export async function sendSms(
  raw: SendSmsInput,
): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  try {
    const input = SendSmsSchema.parse(raw)
    const sb = await typedClient()
    const { userId, role } = await getCurrentRole(sb)
    assertNotProvider(role)
    if (!(await assertBrandMember(sb, userId, role, input.brand_id))) {
      return { ok: false, error: "Sin acceso a esta marca." }
    }

    // `sms_opt_out` es columna nueva (no en los tipos generados) → lectura sin tipar.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: leadRaw } = await (sb as any)
      .from("leads")
      .select("phone, brand_id, sms_opt_out")
      .eq("id", input.lead_id)
      .single()
    const lead = leadRaw as { phone: string | null; brand_id: string; sms_opt_out: boolean | null } | null
    if (!lead || lead.brand_id !== input.brand_id) {
      return { ok: false, error: "El paciente no es válido para esta marca." }
    }
    if (lead.sms_opt_out) {
      return { ok: false, error: "El paciente pidió no recibir mensajes (respondió STOP)." }
    }
    const to = lead.phone
    if (!to || !to.startsWith("+")) {
      return { ok: false, error: "El paciente no tiene un teléfono válido (formato +1…)." }
    }

    const [sid, token, globalFrom, brandFrom] = await Promise.all([
      getConnectionSecret("twilio", "account_sid"),
      getConnectionSecret("twilio", "auth_token"),
      getConnectionSecret("twilio", "from_number"),
      // Número de ENVÍO de la marca (tracking_numbers, provider Twilio). Si la
      // marca no tiene número propio, cae al from_number global.
      resolveBrandTwilioFrom(input.brand_id, input.lead_id),
    ])
    let from = brandFrom
    if (!from && globalFrom) {
      // Respaldo global — pero NO si ese número está registrado como el de OTRA
      // marca (evitaría que esta marca envíe desde el número ajeno y que las
      // respuestas se atribuyan a la otra marca). Fail-closed (Fable #2).
      const globalOwner = await resolveBrandByTwilioNumber(globalFrom)
      if (globalOwner && globalOwner !== input.brand_id) {
        return {
          ok: false,
          error: "Esta marca no tiene número de envío propio. Agrega su número Twilio en Configuración → Números de rastreo.",
        }
      }
      from = globalFrom
    }
    if (!sid || !token || !from) {
      return { ok: false, error: "Twilio no está conectado (falta SID, token o número de envío)." }
    }

    const sent = await sendTwilioSms({ sid, token, from, to, body: input.body })
    if (!sent.ok) return sent

    // Registrar el saliente (messages es service-role para escribir).
    const admin = createAdminClient() as unknown as SupabaseClient<Database>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await (admin as any).from("messages").insert({
      provider: "twilio",
      brand_id: input.brand_id,
      lead_id: input.lead_id,
      direction: "out",
      channel: "sms",
      body: input.body,
      from_number: from,
      to_number: to,
      external_id: sent.sid || null,
      status: "sent",
      created_by: userId,
    })
    revalidatePath(`/leads/${input.lead_id}`)
    if (insErr) {
      // El SMS SÍ se envió; solo no se registró en el hilo. Avisar para que el
      // vendedor no lo reenvíe (Fable #4).
      console.error("[sendSms] registro:", insErr.message)
      return { ok: true, warning: "El SMS se envió, pero no se pudo registrar en el hilo (no lo reenvíes)." }
    }
    return { ok: true }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Datos inválidos" }
    }
    return { ok: false, error: e instanceof Error ? e.message : "Error al enviar el SMS" }
  }
}

// ── Llamar al paciente con el bot de voz (Retell, outbound) ──────────────────

const StartBotCallSchema = z.object({
  lead_id: z.string().uuid(),
  brand_id: z.string().uuid(),
})

/**
 * Dispara una llamada saliente del bot de voz (Retell) al paciente. Mismos guards
 * que sendSms (rol no-provider + membresía de marca + lead de la marca). Requiere
 * RETELL_API_KEY / RETELL_AGENT_ID / RETELL_FROM_NUMBER en env. El bot usa las
 * herramientas de /api/voice/* para agendar y mandar el link de pago.
 */
export async function startBotCall(
  raw: z.infer<typeof StartBotCallSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = StartBotCallSchema.parse(raw)
    const sb = await typedClient()
    const { userId, role } = await getCurrentRole(sb)
    assertNotProvider(role)
    if (!(await assertBrandMember(sb, userId, role, input.brand_id))) {
      return { ok: false, error: "Sin acceso a esta marca." }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: leadRaw } = await (sb as any)
      .from("leads")
      .select("phone, brand_id, first_name, last_name")
      .eq("id", input.lead_id)
      .single()
    const lead = leadRaw as {
      phone: string | null; brand_id: string; first_name: string; last_name: string | null
    } | null
    if (!lead || lead.brand_id !== input.brand_id) {
      return { ok: false, error: "El paciente no es válido para esta marca." }
    }
    const to = lead.phone
    if (!to || !to.startsWith("+")) {
      return { ok: false, error: "El paciente no tiene un teléfono válido (formato +1…)." }
    }

    const apiKey = process.env.RETELL_API_KEY
    const agentId = process.env.RETELL_AGENT_ID
    const from = process.env.RETELL_FROM_NUMBER
    if (!apiKey || !agentId || !from) {
      return { ok: false, error: "Falta configurar Retell (RETELL_API_KEY, RETELL_AGENT_ID y RETELL_FROM_NUMBER en Vercel)." }
    }

    // El LLM no conoce la fecha de hoy → calcula "mañana"/"próximo lunes" mal y
    // agendar_cita rechaza fechas pasadas. Le pasamos la fecha de HOY en hora de
    // California para que el guion la use como referencia. (E164 ya validado arriba.)
    const currentDatePacific = new Intl.DateTimeFormat("es-MX", {
      timeZone: "America/Los_Angeles",
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    }).format(new Date())

    const res = await fetch("https://api.retellai.com/v2/create-phone-call", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from_number: from,
        to_number: to,
        override_agent_id: agentId,
        retell_llm_dynamic_variables: {
          patient_name: `${lead.first_name} ${lead.last_name ?? ""}`.trim(),
          lead_id: input.lead_id,
          patient_phone: to,
          current_date: currentDatePacific,
        },
        metadata: { lead_id: input.lead_id, brand_id: input.brand_id },
      }),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => "")
      console.error("[startBotCall] retell:", res.status, txt.slice(0, 200))
      return { ok: false, error: `No se pudo iniciar la llamada (Retell ${res.status}).` }
    }
    return { ok: true }
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Datos inválidos" }
    return { ok: false, error: e instanceof Error ? e.message : "Error al iniciar la llamada" }
  }
}
