import { NextResponse } from "next/server"

// Forzar Node runtime (no Edge) para que pueda leer todas las env vars
// del proyecto, incluyendo las provisionadas por integraciones.
export const runtime = "nodejs"

/**
 * Endpoint de diagnóstico — NO expone valores, solo flags.
 * Útil para verificar si las env vars llegaron al runtime sin tocar logs.
 */
export async function GET() {
  return NextResponse.json({
    anthropic_key: !!process.env.ANTHROPIC_API_KEY,
    openai_key: !!process.env.OPENAI_API_KEY,
    cron_secret: !!process.env.INTERNAL_CRON_SECRET,
    supabase_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabase_service: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    // NO exponer prefijos de keys: este endpoint es público (PUBLIC_PATHS).
    deployed_at: new Date().toISOString(),
  })
}
