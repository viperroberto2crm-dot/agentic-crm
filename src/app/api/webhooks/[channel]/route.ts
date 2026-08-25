import { handleChannelGet, handleChannelPost } from "@/lib/channels/webhook"

/**
 * Webhook genérico del Centro de Canales: `/api/webhooks/<canal>`.
 *
 * Un canal nuevo (Instagram DM, Messenger, Email) queda expuesto aquí solo con
 * registrar su adaptador — sin escribir una ruta.
 *
 * Los canales que YA están dados de alta con su proveedor conservan su ruta
 * estática propia (`/twilio`, `/whatsapp`), que Next resuelve antes que esta;
 * las dos terminan en el mismo manejador.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request, ctx: { params: Promise<{ channel: string }> }) {
  const { channel } = await ctx.params
  return handleChannelGet(request, channel)
}

export async function POST(request: Request, ctx: { params: Promise<{ channel: string }> }) {
  const { channel } = await ctx.params
  return handleChannelPost(request, channel)
}
