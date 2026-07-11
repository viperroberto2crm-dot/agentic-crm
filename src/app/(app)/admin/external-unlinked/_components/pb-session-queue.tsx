"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RefreshCw, AlertTriangle } from "lucide-react"
import { retryPbSession } from "@/app/(app)/settings/_actions/pb-service-map-actions"

// Cola de sesiones de Practice Better que NO se pudieron empujar: servicio sin
// mapear ('unmapped') o error ('failed'). Fase 3.3: visibilidad + reintento. Tras
// mapear el servicio en Settings, el admin pica "Reintentar" y se crea la sesión.

export type PbSessionQueueRow = {
  id: string
  customer_name: string | null
  service: string | null
  service_name: string | null
  starts_at: string | null
  pb_session_status: string | null
  pb_error: string | null
}

function statusLabel(s: string | null): string {
  switch (s) {
    case "unmapped":
      return "Servicio sin mapear"
    case "failed":
      return "Falló"
    case "pushing":
      return "En proceso"
    default:
      return s ?? "—"
  }
}

export function PbSessionQueue({ rows }: { rows: PbSessionQueueRow[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  if (rows.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4 text-[#D9A441]" />
        Citas sin sesión en Practice Better ({rows.length})
      </h2>
      <p className="text-xs text-muted-foreground -mt-1">
        Estas citas no se pudieron crear en Practice Better. Si es &quot;servicio sin
        mapear&quot;, agrega el mapeo en Ajustes → Servicios PB y luego reintenta.
      </p>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      <div className="rounded-lg border border-border/60 divide-y divide-border/60 bg-white">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="text-muted-foreground w-28 shrink-0 tabular-nums text-xs">
              {r.starts_at ? new Date(r.starts_at).toLocaleDateString() : "—"}
            </span>
            <span className="flex-1 min-w-0 truncate">
              {r.customer_name ?? "Cliente"}
              <span className="text-muted-foreground">
                {" · "}
                {r.service_name ?? r.service ?? "Servicio"}
              </span>
            </span>
            <span
              className={`text-[11px] shrink-0 ${
                r.pb_session_status === "failed" ? "text-[#C4453B]" : "text-[#D9A441]"
              }`}
              title={r.pb_error ?? undefined}
            >
              {statusLabel(r.pb_session_status)}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs gap-1 shrink-0"
              disabled={busyId === r.id}
              onClick={async () => {
                setBusyId(r.id)
                setMsg(null)
                try {
                  const res = await retryPbSession(r.id)
                  if (res.ok) {
                    setMsg(`Reintento: ${res.status}`)
                    router.refresh()
                  } else {
                    setMsg(res.error)
                  }
                } finally {
                  setBusyId(null)
                }
              }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyId === r.id ? "animate-spin" : ""}`} />
              Reintentar
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}
