import { NextResponse } from "next/server"
import { verifyVoiceSecret, getOrCreatePatient, asStr } from "@/lib/voice/core"
import { resolveCaller } from "@/lib/voice/clinic-numbers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Herramienta del bot: buscar o crear al paciente por teléfono (Si Se Pierde).
export async function POST(req: Request) {
  if (!verifyVoiceSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { /* vacío */ }
  const args = body?.args ?? body ?? {}
  // La marca puede venir en los args del bot o en la URL (?brand=la-esperanza).
  const brand = asStr(args.brand) ?? new URL(req.url).searchParams.get("brand") ?? undefined

  // Número REAL capturado por Twilio/Retell (from_number entrantes, to_number salientes).
  const call = body?.call ?? {}
  // Si la llamada llegó reenviada desde un número de la clínica o de rastreo (ej. el
  // 714-467-2002, los de 800.com), ese número NO es del paciente: se descarta, y nos
  // quedamos con `cameFrom` para decirle al bot por dónde llamó (ver clinic-numbers.ts).
  const caller = await resolveCaller(asStr(call.direction === "outbound" ? call.to_number : call.from_number))
  const callerId = caller.phone ?? ""
  const cameFrom = caller.cameFrom ? { came_from: caller.cameFrom } : {}

  // Teléfono principal: el que dio el bot si es válido; si mandó el placeholder sin
  // sustituir o algo inválido, cae al número real de la llamada.
  let phone = asStr(args.phone) ?? ""
  const botGaveValid =
    !!phone && !phone.includes("{{") && !phone.toLowerCase().includes("from_number") &&
    !phone.toLowerCase().includes("patient_phone") && !!(await resolveCaller(phone)).phone
  if (!botGaveValid) phone = callerId
  if (!phone) {
    return NextResponse.json({
      ok: false,
      ...cameFrom,
      error:
        "No tengo el número del paciente (la llamada llegó reenviada desde un número de la clínica). " +
        "Pídele su número con lada, repíteselo y vuelve a llamar a esta herramienta con ese número en phone.",
    })
  }

  // Si el paciente dio un número DISTINTO al de la llamada, guarda el de la llamada
  // como alterno (así no se pierde ninguno).
  const phoneAlt = botGaveValid && callerId && callerId !== phone ? callerId : undefined

  const r = await getOrCreatePatient({
    phone,
    phone_alt: phoneAlt,
    first_name: asStr(args.first_name),
    last_name: asStr(args.last_name),
    email: asStr(args.email),
    brand: brand ?? undefined,
  })
  return NextResponse.json({ ...r, ...cameFrom })
}
