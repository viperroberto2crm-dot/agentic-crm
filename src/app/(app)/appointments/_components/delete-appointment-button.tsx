"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Trash2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { deleteAppointment } from "../actions"

export function DeleteAppointmentButton({ appointmentId }: { appointmentId: string }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    setError(null)
    startTransition(async () => {
      const res = await deleteAppointment(appointmentId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setConfirm(false)
      router.refresh()
    })
  }

  if (confirm) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleDelete}
          disabled={isPending}
          className="h-6 px-1.5 text-[10px] font-semibold text-red-600 hover:bg-red-50"
          title={error ?? "Sí, borrar"}
        >
          {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Sí"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => { setConfirm(false); setError(null) }}
          disabled={isPending}
          className="h-6 px-1.5 text-[10px] text-gray-400 hover:bg-gray-100"
        >
          No
        </Button>
      </span>
    )
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={(e) => { e.stopPropagation(); setConfirm(true) }}
      title="Borrar cita"
      className="h-7 w-7 p-0 text-gray-400 hover:bg-red-50 hover:text-red-500"
    >
      <Trash2 className="w-3.5 h-3.5" />
      <span className="sr-only">Borrar</span>
    </Button>
  )
}
