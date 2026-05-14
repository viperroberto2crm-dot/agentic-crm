import { NextResponse } from "next/server"

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
    // Solo el prefijo de las keys (para detectar si copiaste mal)
    openai_prefix: process.env.OPENAI_API_KEY?.slice(0, 7) ?? null,
    anthropic_prefix: process.env.ANTHROPIC_API_KEY?.slice(0, 11) ?? null,
    deployed_at: new Date().toISOString(),
  })
}
