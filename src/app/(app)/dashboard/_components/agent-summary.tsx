import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MessageSquare, RotateCcw } from "lucide-react"
import Link from "next/link"
import { regenerateAgentSummary } from "../actions"
import type { AgentSummary } from "@/lib/queries/dashboard"
import { getTranslations } from "next-intl/server"

function isAfter8am(timezone: string): boolean {
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  )
  return hour >= 8
}

export async function AgentSummaryCard({
  summary,
  timezone,
}: {
  summary: AgentSummary
  timezone: string
}) {
  const t = await getTranslations("dashboard")
  const late = isAfter8am(timezone)
  const body =
    summary?.body ??
    (late ? t("summaryFailed") : t("summaryPending"))

  return (
    <Card
      className="border-0 rounded-2xl text-white shadow-[0_6px_20px_rgba(14,95,76,.22)]"
      style={{ background: "linear-gradient(115deg, #0E5F4C 0%, #14735C 60%, #1C8A6E 100%)" }}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <MessageSquare className="w-4 h-4 text-white" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-white/70 uppercase tracking-widest font-semibold">
                {t("agentDailySummary")}
              </p>
              {summary && (
                <form action={regenerateAgentSummary}>
                  <button
                    type="submit"
                    className="text-white/60 hover:text-white transition-colors cursor-pointer"
                    title={t("regenerateSummary")}
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </form>
              )}
            </div>
            <p className="text-sm text-white/90 leading-relaxed">{body}</p>
            {/* PHASE B plug-in: pending agent actions for this user */}
          </div>
        </div>

        {summary && (
          <div className="mt-3 flex gap-2 flex-wrap pl-11">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] bg-white/10 border-white/25 text-white hover:bg-white/20 hover:text-white hover:border-white/45 rounded-lg px-3"
              asChild
            >
              <Link href="/leads?filter=stale">{t("viewStaleLeads")}</Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] bg-white/10 border-white/25 text-white hover:bg-white/20 hover:text-white hover:border-white/45 rounded-lg px-3"
              asChild
            >
              <Link href="/calls">{t("logCall")}</Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] bg-white/10 border-white/25 text-white hover:bg-white/20 hover:text-white hover:border-white/45 rounded-lg px-3"
              asChild
            >
              <Link href="/appointments">{t("viewAppts")}</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
