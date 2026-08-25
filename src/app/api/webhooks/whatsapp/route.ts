import { handleChannelGet, handleChannelPost } from "@/lib/channels/webhook"

/**
 * Webhook de WhatsApp Cloud API (Meta).
 *
 * La lógica vive en el Centro de Canales (`lib/channels/`): esto es solo la URL.
 * Se conserva como ruta propia porque **ya está registrada en Meta** — cambiarla
 * tiraría el canal en vivo.
 *
 * URL registrada en Meta → App → WhatsApp → Configuration:
 *   https://<dominio>/api/webhooks/whatsapp
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return handleChannelGet(request, "whatsapp")
}

export async function POST(request: Request) {
  return handleChannelPost(request, "whatsapp")
}
