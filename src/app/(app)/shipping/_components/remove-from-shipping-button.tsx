"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, X } from "lucide-react"
import { unapproveForShipping } from "../../appointments/actions"

/**
 * Quita una cita de la cola de envíos (provider_approved → false).
 * NO borra la cita ni las notas del provider: la cita sigue existiendo en
 * Appointments y se puede volver a aprobar. Útil cuando el "envío" en
 * realidad era solo una nota (ej. "Llamé, no contestó") y no requiere
 * mandar producto. Bloqueado por el servidor si ya fue marcado enviado.
 */
export function RemoveFromShippingButton({ appointmentId }: { appointmentId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await unapproveForShipping(appointmentId)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al quitar")
        setConfirming(false)
      }
    })
  }

  if (confirming && !isPending) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleClick}
            className="h-8 px-3 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
          >
            Sí, quitar
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false)
              setError(null)
            }}
            className="h-8 px-2.5 rounded-md text-xs text-gray-500 hover:bg-gray-100"
          >
            Cancelar
          </button>
        </div>
        {error && <p className="text-[10px] text-red-500">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="h-9 px-3 rounded-md border border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
        title="Quitar de la cola de envíos (no borra la cita ni las notas)"
      >
        {isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <X className="w-3.5 h-3.5" />
        )}
        Quitar
      </button>
      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  )
}
