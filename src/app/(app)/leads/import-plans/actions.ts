"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const PlanRowSchema = z.object({
  ref_id: z.string().min(1, "ref_id requerido"),
  first_name: z.string().min(1, "first_name requerido"),
  last_name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  plan_name: z.string().min(1, "plan_name requerido"),
  plan_total: z.number().nonnegative("plan_total inválido"),
  plan_notes: z.string().nullable(),
  plan_installments: z.number().int().min(1).max(100).nullable(),
  plan_frequency: z.string().nullable(),
  plan_first_due: z.string().nullable(),
})

const AbonoRowSchema = z.object({
  ref_id: z.string().min(1),
  amount: z.number().positive("monto debe ser > 0"),
  date: z.string().min(1, "fecha requerida"),
  method: z.string().nullable(),
  notes: z.string().nullable(),
})

export type PlanImportRow = z.infer<typeof PlanRowSchema>
export type AbonoImportRow = z.infer<typeof AbonoRowSchema>

export type ImportPlansResult = {
  plans_imported: number
  abonos_imported: number
  errors: Array<{ ref_id?: string; sheet: "Plans" | "Payments"; message: string }>
}

function freqToDays(freq: string | null): number | null {
  if (!freq) return null
  const f = freq.trim().toLowerCase()
  if (f === "weekly" || f === "semanal") return 7
  if (f === "biweekly" || f === "quincenal") return 14
  if (f === "monthly" || f === "mensual") return 30
  const n = parseInt(f, 10)
  return Number.isFinite(n) && n >= 1 && n <= 365 ? n : null
}

// Acepta MM/DD/YYYY, M/D/YY, YYYY-MM-DD
function parseDate(raw: string | null): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  // YYYY-MM-DD ya válido
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // MM/DD/YYYY o M/D/YY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const month = m[1].padStart(2, "0")
    const day = m[2].padStart(2, "0")
    let year = m[3]
    if (year.length === 2) year = `20${year}`
    return `${year}-${month}-${day}`
  }
  return null
}

// ── Server action ─────────────────────────────────────────────────────────────

export async function importPaymentPlans(
  rawPlans: unknown[],
  rawAbonos: unknown[],
  brandId: string,
): Promise<ImportPlansResult> {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const result: ImportPlansResult = { plans_imported: 0, abonos_imported: 0, errors: [] }

  // 1) Validar todas las filas primero
  const validPlans: PlanImportRow[] = []
  for (let i = 0; i < rawPlans.length; i++) {
    const p = PlanRowSchema.safeParse(rawPlans[i])
    if (!p.success) {
      result.errors.push({
        sheet: "Plans",
        ref_id: (rawPlans[i] as { ref_id?: string })?.ref_id,
        message: `Fila ${i + 2}: ${p.error.issues.map((x) => x.message).join(", ")}`,
      })
      continue
    }
    validPlans.push(p.data)
  }

  const validAbonos: AbonoImportRow[] = []
  for (let i = 0; i < rawAbonos.length; i++) {
    const a = AbonoRowSchema.safeParse(rawAbonos[i])
    if (!a.success) {
      result.errors.push({
        sheet: "Payments",
        ref_id: (rawAbonos[i] as { ref_id?: string })?.ref_id,
        message: `Fila ${i + 2}: ${a.error.issues.map((x) => x.message).join(", ")}`,
      })
      continue
    }
    validAbonos.push(a.data)
  }

  // Agrupar abonos por ref_id
  const abonosByRef = new Map<string, AbonoImportRow[]>()
  for (const ab of validAbonos) {
    const arr = abonosByRef.get(ab.ref_id) ?? []
    arr.push(ab)
    abonosByRef.set(ab.ref_id, arr)
  }

  // 2) Procesar cada plan
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  for (const plan of validPlans) {
    try {
      // a) Crear lead nuevo (siempre — la usuaria pidió "wipe + start fresh")
      const phoneClean = plan.phone?.trim() || null
      const { data: leadRow, error: leadErr } = await sb
        .from("leads")
        .insert({
          brand_id: brandId,
          first_name: plan.first_name.trim(),
          last_name: plan.last_name?.trim() || null,
          phone: phoneClean,
          email: plan.email?.trim() || null,
          status: "sold", // Si tienen plan = ya están vendidos
          assigned_rep_id: user.id,
          created_by: user.id,
        })
        .select("id")
        .single()

      if (leadErr || !leadRow) {
        result.errors.push({
          sheet: "Plans",
          ref_id: plan.ref_id,
          message: `Error creando lead: ${leadErr?.message ?? "unknown"}`,
        })
        continue
      }
      const leadId = leadRow.id as string

      // b) Crear sale linkeada con status 'partial'
      const totalCents = Math.round(plan.plan_total * 100)
      const { data: saleRow, error: saleErr } = await sb
        .from("sales")
        .insert({
          brand_id: brandId,
          lead_id: leadId,
          rep_id: user.id,
          amount_cents: totalCents,
          payment_method: "cash",
          payment_status: "partial",
          notes: `Auto-generado desde Payment Plan: ${plan.plan_name}`,
        })
        .select("id")
        .single()

      if (saleErr || !saleRow) {
        result.errors.push({
          sheet: "Plans",
          ref_id: plan.ref_id,
          message: `Lead creado pero falló sale: ${saleErr?.message}`,
        })
        continue
      }

      // c) Crear payment_plan
      const installmentAmountCents =
        plan.plan_installments != null && plan.plan_installments > 0
          ? Math.round(totalCents / plan.plan_installments)
          : null
      const freqDays = freqToDays(plan.plan_frequency)
      const firstDue = parseDate(plan.plan_first_due)

      const { data: planRow, error: planErr } = await sb
        .from("payment_plans")
        .insert({
          lead_id: leadId,
          brand_id: brandId,
          product_name: plan.plan_name,
          total_amount_cents: totalCents,
          notes: plan.plan_notes ?? null,
          installment_count: plan.plan_installments,
          installment_amount_cents: installmentAmountCents,
          frequency_days: freqDays,
          first_due_date: firstDue,
          created_by: user.id,
          sale_id: saleRow.id,
        })
        .select("id")
        .single()

      if (planErr || !planRow) {
        result.errors.push({
          sheet: "Plans",
          ref_id: plan.ref_id,
          message: `Lead+Sale OK pero falló plan: ${planErr?.message}`,
        })
        continue
      }
      const planId = planRow.id as string
      result.plans_imported++

      // d) Crear abonos
      const myAbonos = abonosByRef.get(plan.ref_id) ?? []
      let paidTotalCents = 0
      for (const ab of myAbonos) {
        const abDate = parseDate(ab.date)
        if (!abDate) {
          result.errors.push({
            sheet: "Payments",
            ref_id: plan.ref_id,
            message: `Fecha inválida '${ab.date}'`,
          })
          continue
        }
        const cents = Math.round(ab.amount * 100)
        const { error: abErr } = await sb.from("abonos").insert({
          plan_id: planId,
          lead_id: leadId,
          brand_id: brandId,
          amount_cents: cents,
          paid_at: abDate,
          payment_method: ab.method?.trim() || "cash",
          notes: ab.notes?.trim() || null,
          recorded_by: user.id,
        })
        if (abErr) {
          result.errors.push({
            sheet: "Payments",
            ref_id: plan.ref_id,
            message: `Abono error: ${abErr.message}`,
          })
        } else {
          result.abonos_imported++
          paidTotalCents += cents
        }
      }

      // e) Actualizar el sale_status según total pagado
      let saleStatus: "pending" | "partial" | "paid" = "partial"
      if (paidTotalCents <= 0) saleStatus = "pending"
      else if (paidTotalCents >= totalCents) saleStatus = "paid"
      await sb.from("sales").update({ payment_status: saleStatus }).eq("id", saleRow.id)
    } catch (e) {
      result.errors.push({
        sheet: "Plans",
        ref_id: plan.ref_id,
        message: e instanceof Error ? e.message : "Error desconocido",
      })
    }
  }

  // Reportar abonos huérfanos (ref_id que no matchea ningún plan)
  const importedRefs = new Set(validPlans.map((p) => p.ref_id))
  for (const [ref] of abonosByRef.entries()) {
    if (!importedRefs.has(ref)) {
      result.errors.push({
        sheet: "Payments",
        ref_id: ref,
        message: `ref_id '${ref}' no matchea ningún plan en hoja Plans`,
      })
    }
  }

  revalidatePath("/leads")
  revalidatePath("/dashboard")
  revalidatePath("/sales")
  return result
}
