import { NextResponse } from "next/server"
import { verifyVoiceSecret, sendPaymentLink, asStr } from "@/lib/voice/core"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Herramienta del bot: generar el link de pago y mandarlo por SMS al paciente.
export async function POST(req: Request) {
  if (!verifyVoiceSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { /* vacío */ }
  const args = body?.args ?? body ?? {}
  const brand = asStr(args.brand) ?? new URL(req.url).searchParams.get("brand") ?? undefined
  const r = await sendPaymentLink({ lead_id: asStr(args.lead_id) ?? "", offer_key: asStr(args.offer_key), brand: brand ?? undefined })
  return NextResponse.json(r)
}
