"use client"

import { RepCellSelect, type RepOption } from "@/components/ui/rep-cell-select"
import { reassignAppointmentRep } from "../actions"

export function RepCellSelectClient({
  appointmentId,
  currentRepId,
  currentRepName,
  reps,
  canEdit,
}: {
  appointmentId: string
  currentRepId: string | null
  currentRepName: string | null
  reps: RepOption[]
  canEdit: boolean
}) {
  return (
    <RepCellSelect
      currentRepId={currentRepId}
      currentRepName={currentRepName}
      reps={reps}
      canEdit={canEdit}
      onReassign={(newRepId) => reassignAppointmentRep(appointmentId, newRepId)}
    />
  )
}
