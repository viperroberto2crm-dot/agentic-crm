import { NextRequest, NextResponse } from "next/server"
import {
  createPbRecord,
  deletePbRecord,
  listPbInvoices,
  pbId,
} from "@/lib/integrations/practice-better"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// TEMPORAL: prueba real de createPbRecord. Crea un record de prueba en PB,
// confirma que se creó (200 + id), y lo borra enseguida. Auth por CRON_SECRET.
// Se elimina tras verificar.

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization")
  if (!auth) return false
  const secrets = [process.env.CRON_SECRET, process.env.HERMES_SECRET].filter(Boolean)
  return secrets.some((s) => auth === `Bearer ${s}`)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "no autorizado" }, { status: 401 })

  // Limpieza de un record específico (huérfano de prueba): ?cleanup=<id>
  const cleanupId = new URL(req.url).searchParams.get("cleanup")
  if (cleanupId) {
    try {
      await deletePbRecord(cleanupId)
      return NextResponse.json({ ok: true, cleaned: cleanupId })
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
    }
  }

  const stamp = `${Date.now()}`
  try {
    const rec = await createPbRecord({
      firstName: "ZZ_TEST_HORIZON",
      lastName: stamp,
      email: `zz_test_${stamp}@horizon-selftest.invalid`,
    })
    const id = pbId(rec)
    let deleted = false
    let deleteError: string | null = null
    if (id) {
      try {
        await deletePbRecord(id)
        deleted = true
      } catch (e) {
        deleteError = e instanceof Error ? e.message : String(e)
      }
    }
    // Inspeccionar un invoice real para confirmar la UNIDAD del monto
    // (dólares vs centavos). Solo devolvemos números, sin PII.
    let invoiceUnitCheck: unknown = null
    try {
      const invs = await listPbInvoices()
      const sample = invs[0] as { total?: { amount?: number; currency?: string }; paymentStatus?: string } | undefined
      if (sample) {
        invoiceUnitCheck = {
          total_amount_raw: sample.total?.amount ?? null,
          currency: sample.total?.currency ?? null,
          paymentStatus: sample.paymentStatus ?? null,
          totalInvoices: invs.length,
          interpretacion:
            typeof sample.total?.amount === "number"
              ? sample.total.amount % 1 !== 0
                ? "tiene decimales → probablemente DÓLARES (ej 120.50)"
                : "entero → AMBIGUO, comparar con el monto real en PB"
              : "sin dato",
        }
      } else {
        invoiceUnitCheck = { totalInvoices: 0, nota: "no hay invoices en PB" }
      }
    } catch (e) {
      invoiceUnitCheck = { error: e instanceof Error ? e.message : String(e) }
    }

    return NextResponse.json({
      ok: true,
      created: Boolean(id),
      recordId: id,
      deleted,
      deleteError,
      invoiceUnitCheck,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, created: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}
