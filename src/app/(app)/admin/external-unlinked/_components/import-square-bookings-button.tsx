"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CalendarClock } from "lucide-react"
import { importSquareBookings } from "../_actions/import-square-bookings"

/**
 * Botón admin para RECUPERAR las citas de Square que se perdieron durante el
 * apagón del webhook (≈7-9 jul 2026, daba 500). Jala la Bookings API de una
 * ventana de días y mete/rutea las citas igual que el webhook. Idempotente:
 * las que ya existen se saltan. Solo admin.
 */
export function ImportSquareBookingsButton() {
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
              "¿Recuperar citas de Square del apagón del webhook? Jala las citas de los últimos días y las mete/rutea igual que el webhook. Las que ya existen se saltan (idempotente).",
            )
          ) {
            return
          }
          setLoading(true)
          setMsg(null)
          try {
            const res = await importSquareBookings()
            if (res.ok) {
              setMsg(
                `${res.found} encontrada(s) · ${res.imported} importada(s) · ${res.linkedToLead} vinculada(s) a lead · ${res.skippedExisting} ya existían`,
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
        <CalendarClock className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        Recuperar citas de Square (apagón)
      </Button>
    </div>
  )
}
