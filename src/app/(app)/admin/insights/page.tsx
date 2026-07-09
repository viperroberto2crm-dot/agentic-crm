import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { runReflectionNowAction } from "./actions"
import { BRAND_TIMEZONE, parseDbDate } from "@/lib/datetime"

type SB = SupabaseClient<Database>

export const dynamic = "force-dynamic"

function fmtDate(d: string) {
  const parsed = parseDbDate(d)
  if (!parsed) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BRAND_TIMEZONE,
  }).format(parsed)
}

export default async function AgentInsightsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as SB
  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).single()
  const role = (profile?.role ?? "rep") as string
  if (role !== "admin") redirect("/dashboard")

  const cookieStore = await cookies()
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  const { data: reflections } = await sb
    .from("self_reflection_runs")
    .select("id, period_start, period_end, patterns_detected, total_calls_analyzed, notes, created_at")
    .order("created_at", { ascending: false })
    .limit(20)

  let patternsQ = sb
    .from("knowledge_patterns")
    .select("id, type, title, content, effectiveness_score, evidence_count, source, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(50)
  if (brandId) patternsQ = patternsQ.eq("brand_id", brandId)
  const { data: patterns } = await patternsQ

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Agent Insights</h1>
          <p className="text-xs text-gray-400 mt-1">
            Reflexiones automáticas del bot y patrones de comportamiento aprendidos.
          </p>
        </div>
        <form action={runReflectionNowAction}>
          <Button
            type="submit"
            size="sm"
            className="cursor-pointer"
            style={{ background: "var(--brand)" }}
          >
            Ejecutar reflexión ahora
          </Button>
        </form>
      </div>

      <Card className="bg-white border-gray-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
            Patrones aprendidos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!patterns || patterns.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              Aún no hay patrones. Ejecuta una reflexión o espera al cron nocturno.
            </p>
          ) : (
            <div className="space-y-3">
              {patterns.map((p) => (
                <div key={p.id} className="border border-gray-100 rounded-md p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 leading-snug">{p.title}</p>
                      <p className="text-xs text-gray-500 mt-1 leading-relaxed">{p.content}</p>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-gray-300 text-gray-500">
                        {p.type ?? "other"}
                      </Badge>
                      <p className="text-[10px] text-gray-400 tabular-nums">
                        score {Number(p.effectiveness_score ?? 0).toFixed(2)} · {p.evidence_count ?? 0} ev
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white border-gray-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
            Reflexiones recientes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!reflections || reflections.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">Sin reflexiones registradas todavía.</p>
          ) : (
            <div className="space-y-2">
              {reflections.map((r) => {
                let summary = ""
                try {
                  const parsed = JSON.parse((r.notes as string) ?? "{}") as { summary?: string }
                  summary = parsed.summary ?? ""
                } catch {
                  summary = ""
                }
                const patternCount = Array.isArray(r.patterns_detected)
                  ? r.patterns_detected.length
                  : 0
                return (
                  <div key={r.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-100 last:border-0">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-700 truncate">{summary || "—"}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {fmtDate(r.created_at as string)} · {r.total_calls_analyzed ?? 0} runs · {patternCount} patrones
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
