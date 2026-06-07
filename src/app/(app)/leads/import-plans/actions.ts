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

// ── Schemas ───────────────────────────────────────────────────────────────────

const PlanRowSchema = z.object({
  ref_id: z.string().min(1, "ref_id requerido"),
  first_name: z.string().min(1, "first_name requerido"),
  last_name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  assigned_rep: z.string().nullable(),
  plan_name: z.string().min(1, "plan_name requerido"),
  plan_total: z.number().nonnegative("plan_total inválido").nullable(),
  plan_per_installment: z.number().positive().nullable(),
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
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
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

  // Pre-cargar usuarios activos para matchear reps por nombre
  const { data: allUsers } = await sb
    .from("users")
    .select("id, name, email")
    .eq("active", true)
  const userList: Array<{ id: string; name: string; email: string }> = allUsers ?? []

  function findRepByText(text: string | null | undefined): string | null {
    if (!text) return null
    const t = text.trim().toLowerCase()
    if (!t) return null
    // Quita prefijos comunes que la usuaria pone: 'S.S Moe' → 'moe', 'SSP-Andreina' → 'andreina'
    const cleaned = t
      .replace(/^(s\.?\s*[swp]\.?\s*[-\s]*)/i, "")
      .replace(/^(ssp?[-\s]+)/i, "")
      .replace(/[.,]/g, "")
      .trim()
    const candidates = cleaned ? [cleaned, t] : [t]
    for (const c of candidates) {
      const found = userList.find(
        (u) =>
          u.name?.toLowerCase().includes(c) ||
          u.email?.toLowerCase().startsWith(c + "@"),
      )
      if (found) return found.id
    }
    return null
  }

  for (const plan of validPlans) {
    try {
      // Computar total efectivo: prioriza plan_total; si no, multiplica per_installment × installments
      const effectiveTotal: number = (() => {
        if (plan.plan_total != null && plan.plan_total > 0) return plan.plan_total
        if (plan.plan_per_installment != null && plan.plan_installments != null) {
          return plan.plan_per_installment * plan.plan_installments
        }
        return 0
      })()

      if (effectiveTotal <= 0) {
        result.errors.push({
          sheet: "Plans",
          ref_id: plan.ref_id,
          message: "plan_total vacío y plan_per_installment × plan_installments no se puede calcular",
        })
        continue
      }

      // a) Crear lead nuevo (siempre — la usuaria pidió "wipe + start fresh")
      const phoneClean = plan.phone?.trim() || null
      const matchedRepId = findRepByText(plan.assigned_rep)
      const repText = plan.assigned_rep?.trim() || null
      // Si el rep no se pudo matchear, lo apuntamos en las notas para no perderlo
      const repFallbackNote =
        repText && !matchedRepId ? `[Rep desde import: ${repText}]` : null
      const combinedNotes = [plan.plan_notes?.trim(), repFallbackNote]
        .filter(Boolean)
        .join(" · ") || null

      const { data: leadRow, error: leadErr } = await sb
        .from("leads")
        .insert({
          brand_id: brandId,
          first_name: plan.first_name.trim(),
          last_name: plan.last_name?.trim() || null,
          phone: phoneClean,
          email: plan.email?.trim() || null,
          status: "sold", // Si tienen plan = ya están vendidos
          assigned_rep_id: matchedRepId ?? user.id,
          notes: combinedNotes,
          created_by: user.id,
        })
        .select("id")
        .single()

      if (repText && !matchedRepId) {
        result.errors.push({
          sheet: "Plans",
          ref_id: plan.ref_id,
          message: `Rep '${repText}' no matchea ningún usuario activo — lead asignado a ti. Crea ese rep en Settings → Users.`,
        })
      }

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
      const totalCents = Math.round(effectiveTotal * 100)
      const { data: saleRow, error: saleErr } = await sb
        .from("sales")
        .insert({
          brand_id: brandId,
          lead_id: leadId,
          rep_id: matchedRepId ?? user.id,
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
      const installmentAmountCents = (() => {
        if (plan.plan_per_installment != null && plan.plan_per_installment > 0) {
          return Math.round(plan.plan_per_installment * 100)
        }
        if (plan.plan_installments != null && plan.plan_installments > 0) {
          return Math.round(totalCents / plan.plan_installments)
        }
        return null
      })()
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
      let lastAbonoDate: string | null = null
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
          if (!lastAbonoDate || abDate > lastAbonoDate) lastAbonoDate = abDate
        }
      }

      // e) Actualizar el sale_status según total pagado
      let saleStatus: "pending" | "partial" | "paid" = "partial"
      if (paidTotalCents <= 0) saleStatus = "pending"
      else if (paidTotalCents >= totalCents) saleStatus = "paid"
      // Si quedó pagado, setear paid_at a la fecha del último abono (igual que
      // refreshPlanSaleStatus) — sino la sale queda paid con paid_at NULL.
      const saleUpdate: { payment_status: typeof saleStatus; paid_at?: string } = { payment_status: saleStatus }
      if (saleStatus === "paid" && lastAbonoDate) saleUpdate.paid_at = lastAbonoDate
      await sb.from("sales").update(saleUpdate).eq("id", saleRow.id)
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
