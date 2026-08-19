import { NextResponse } from "next/server"
import { verifyVoiceSecret, getOrCreatePatient, asStr } from "@/lib/voice/core"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Herramienta del bot: buscar o crear al paciente por teléfono (Si Se Pierde).
export async function POST(req: Request) {
  if (!verifyVoiceSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { /* vacío */ }
  const args = body?.args ?? body ?? {}
  const r = await getOrCreatePatient({
    phone: asStr(args.phone) ?? "",
    first_name: asStr(args.first_name),
    last_name: asStr(args.last_name),
    email: asStr(args.email),
    brand: asStr(args.brand),
  })
  return NextResponse.json(r)
}
