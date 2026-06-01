import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Paths públicos que NO pasan por la verificación de sesión.
// (Los crons usan su propio CRON_SECRET en lugar de cookies de sesión.
// Los webhooks validan su propia firma HMAC.)
const PUBLIC_PATHS = [
  "/api/agent/diag",
  "/api/agent/reflect",
  "/api/agent/daily-insights",
  "/api/agent/poll-800com",
  "/api/agent/poll-meta-leads",
  "/api/agent/transcribe-calls",
  "/api/admin/800com/",
  "/api/hermes/",  // Hermes bot: tick + futuros endpoints. Usa HERMES_SECRET/CRON_SECRET en lugar de session.
  "/api/webhooks/",  // todos los webhooks (800com, twilio futuro, etc.)
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
