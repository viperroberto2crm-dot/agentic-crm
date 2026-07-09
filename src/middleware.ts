import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Paths públicos que NO pasan por la verificación de sesión.
// (Los crons usan su propio CRON_SECRET en lugar de cookies de sesión.
// Los webhooks validan su propia firma HMAC.)
const PUBLIC_PATHS = [
  // /api/agent/diag YA NO es público: requiere sesión (se quitó 2026-06-10
  // porque exponía qué env vars están configuradas a visitantes anónimos)
  "/api/agent/reflect",
  "/api/agent/daily-insights",
  "/api/agent/poll-800com",
  "/api/agent/poll-meta-leads",
  "/api/agent/poll-practicebetter",
  "/api/agent/transcribe-calls",
  "/api/admin/800com/",
  "/api/hermes/",  // Hermes bot: tick + futuros endpoints. Usa HERMES_SECRET/CRON_SECRET en lugar de session.
  "/api/webhooks/",  // todos los webhooks (800com, twilio futuro, etc.)
  "/api/leads/public",  // captura de leads desde landing pages externas. Auth via x-api-key.
  "/intake/",  // tablet pública de admisión en clínica /intake/[brand]. El slug se valida contra marcas elegibles. (/intake sin slug = página interna con sesión.)
  "/admision",  // landing pública de selección de clínica (kiosco/tablet). Sin datos sensibles.
  "/api/cron/",  // crons internos (auto-link-calls, etc.). Auth via CRON_SECRET/HERMES_SECRET.
  "/auth/confirm",  // verifyOtp de invite/recovery/magic-link: el usuario aún NO tiene sesión.
]

export async function middleware(request: NextRequest) {
  // Bypass: rutas públicas (diagnóstico, webhooks futuros, etc.)
  if (PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p))) {
    return NextResponse.next()
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
