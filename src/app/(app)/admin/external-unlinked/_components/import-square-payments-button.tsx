"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DollarSign } from "lucide-react"
import { importSquarePayments } from "../_actions/import-square-payments"

/**
 * Botón admin para RECUPERAR los pagos de Square que se perdieron durante el
 * apagón del webhook (≈7-9 jul 2026, daba 500). Jala la Payments API de una
 * ventana de días y mete/rutea los pagos igual que el webhook. Idempotente:
 * los que ya existen se saltan. Solo admin.
 */
export function ImportSquarePaymentsButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  return (
    <div className="flex items-center justify-end gap-2">
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs gap-1"
        disabled={loading}
        onClick={async () => {
          if (
            !window.confirm(
              "¿Recuperar pagos de Square del apagón del webhook? Jala los pagos de los últimos días y los mete/rutea igual que el webhook. Los que ya existen se saltan (idempotente).",
            )
          ) {
            return
          }
          setLoading(true)
          setMsg(null)
          try {
            const res = await importSquarePayments()
            if (res.ok) {
              setMsg(
                `${res.found} encontrado(s) · ${res.imported} importado(s) · ${res.linkedToLead} vinculado(s) a lead · ${res.skippedExisting} ya existían`,
              )
              router.refresh()
            } else {
              setMsg(res.error)
            }
          } finally {
            setLoading(false)
          }
        }}
      >
        <DollarSign className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        Recuperar pagos de Square (apagón)
      </Button>
    </div>
  )
}
