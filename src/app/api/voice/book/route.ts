import { NextResponse } from "next/server"
import { verifyVoiceSecret, bookAppointment, asStr } from "@/lib/voice/core"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Herramienta del bot: agendar cita (telesalud) para el paciente.
export async function POST(req: Request) {
  if (!verifyVoiceSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { /* vacío */ }
  const args = body?.args ?? body ?? {}
  const brand = asStr(args.brand) ?? new URL(req.url).searchParams.get("brand") ?? undefined
  const r = await bookAppointment({
    lead_id: asStr(args.lead_id) ?? "",
    when_iso: asStr(args.when_iso ?? args.datetime ?? args.when) ?? "",
    service: asStr(args.service),
    notes: asStr(args.notes),
    brand: brand ?? undefined,
  })
  return NextResponse.json(r)
}
