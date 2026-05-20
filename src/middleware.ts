import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Paths públicos que NO pasan por la verificación de sesión.
// (Los crons usan su propio CRON_SECRET en lugar de cookies de sesión.)
const PUBLIC_PATHS = [
  "/api/agent/diag",
  "/api/agent/reflect",
  "/api/agent/daily-insights",
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
