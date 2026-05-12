import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MessageSquare, RotateCcw } from "lucide-react"
import Link from "next/link"
import { regenerateAgentSummary } from "../actions"
import type { AgentSummary } from "@/lib/queries/dashboard"

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

export function AgentSummaryCard({
  summary,
  timezone,
}: {
  summary: AgentSummary
  timezone: string
}) {
  const late = isAfter8am(timezone)
  const body =
    summary?.body ??
    (late
      ? "No pudimos generar tu resumen hoy. Pregúntale al agente con Cmd+K para un análisis bajo demanda."
      : "El agente generará tu resumen a las 8am.")

  return (
    <Card
      className="bg-zinc-900 border-zinc-800/60 border-l-2"
      style={{ borderLeftColor: "var(--brand)" }}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <MessageSquare
            className="w-4 h-4 mt-0.5 shrink-0"
            style={{ color: "var(--brand)" }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">
                Agente · Resumen diario
              </p>
              {summary && (
                <form action={regenerateAgentSummary}>
                  <button
                    type="submit"
                    className="text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
                    title="Regenerar resumen"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </form>
              )}
            </div>
            <p className="text-sm text-zinc-300 leading-relaxed">{body}</p>
            {/* PHASE B plug-in: pending agent actions for this user */}
          </div>
        </div>

        {summary && (
          <div className="mt-3 flex gap-2 flex-wrap pl-7">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 rounded-md px-3"
              asChild
            >
              <Link href="/leads?filter=stale">Ver leads stale</Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 rounded-md px-3"
              asChild
            >
              <Link href="/calls">Registrar llamada</Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 rounded-md px-3"
              asChild
            >
              <Link href="/appointments">Ver citas</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
