import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { generateDailyInsightsForAllReps } from "@/lib/agent/daily-insights"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  // Vercel injects Authorization: Bearer ${CRON_SECRET} on declared crons.
  // Manual triggers (curl) must supply it too.
  const authHeader = req.headers.get("authorization") ?? ""
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server" },
      { status: 500 },
    )
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Service role: needs to iterate all users + write to notifications for any user.
  const sb = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const result = await generateDailyInsightsForAllReps(sb)

  return NextResponse.json({
    ok: result.errors.length === 0,
    ...result,
  })
}
