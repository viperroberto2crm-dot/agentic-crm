"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { CheckCircle2, XCircle, UserX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { updateAppointmentStatus } from "../actions"
import type { Database } from "@/types/database"

type ApptStatus = Database["public"]["Enums"]["appointment_status"]

type Props = {
  appointmentId: string
  status: ApptStatus
}

/**
 * Botones de acción rápida por fila. Solo visible si status='scheduled' o 'confirmed'.
 * Los terminales (completed/cancelled/no_show/rescheduled) no muestran acciones.
 */
export function AppointmentStatusActions({ appointmentId, status }: Props) {
  const t = useTranslations("appointments")
  const [isPending, startTransition] = useTransition()
  const [busy, setBusy] = useState<ApptStatus | null>(null)

  // No actions for terminal states
  if (status === "completed" || status === "cancelled" || status === "no_show" || status === "rescheduled") {
    return null
  }

  function handle(newStatus: ApptStatus) {
    setBusy(newStatus)
    startTransition(async () => {
      try {
        await updateAppointmentStatus(appointmentId, newStatus)
      } catch (err) {
        console.error("[appointment-status-actions]", err)
      } finally {
        setBusy(null)
      }
    })
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        title={t("markCompleted")}
        disabled={isPending}
        onClick={(e) => {
          e.stopPropagation()
          handle("completed")
        }}
        className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span className="sr-only">{t("markCompleted")}</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        title={t("markNoShow")}
        disabled={isPending}
        onClick={(e) => {
          e.stopPropagation()
          handle("no_show")
        }}
        className="h-7 w-7 p-0 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
      >
        <UserX className="w-3.5 h-3.5" />
        <span className="sr-only">{t("markNoShow")}</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        title={t("markCancelled")}
        disabled={isPending}
        onClick={(e) => {
          e.stopPropagation()
          handle("cancelled")
        }}
        className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
      >
        <XCircle className="w-3.5 h-3.5" />
        <span className="sr-only">{t("markCancelled")}</span>
      </Button>
      {busy && (
        <span className="text-[10px] text-gray-400 ml-1">…</span>
      )}
    </div>
  )
}
