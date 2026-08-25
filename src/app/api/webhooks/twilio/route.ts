import { handleChannelPost } from "@/lib/channels/webhook"

/**
 * Webhook de SMS (Twilio).
 *
 * La lógica vive en el Centro de Canales (`lib/channels/`): esto es solo la URL.
 * Se conserva como ruta propia porque **ya está configurada en Twilio** —
 * cambiarla tiraría el canal en vivo.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  return handleChannelPost(request, "twilio")
}
