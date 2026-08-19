import { NextResponse } from "next/server"
import { verifyVoiceSecret, logCall, asStr } from "@/lib/voice/core"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Herramienta del bot: registrar el resultado de la llamada (a la tabla calls).
export async function POST(req: Request) {
  if (!verifyVoiceSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { /* vacío */ }
  const args = body?.args ?? body ?? {}
  const brand = asStr(args.brand) ?? new URL(req.url).searchParams.get("brand") ?? undefined
  const r = await logCall({
    phone: asStr(args.phone),
    lead_id: asStr(args.lead_id),
    direction: asStr(args.direction) === "outbound" ? "outbound" : "inbound",
    outcome: asStr(args.outcome),
    summary: asStr(args.summary),
    transcript: asStr(args.transcript),
    recording_url: asStr(args.recording_url),
    brand: brand ?? undefined,
  })
  return NextResponse.json(r)
}
