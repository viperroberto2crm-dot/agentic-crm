"use client"

import { RepCellSelect, type RepOption } from "@/components/ui/rep-cell-select"
import { reassignTaskAssignee } from "../actions"

export function RepCellSelectClient({
  taskId,
  currentRepId,
  currentRepName,
  reps,
  canEdit,
}: {
  taskId: string
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
      onReassign={(newRepId) => reassignTaskAssignee(taskId, newRepId)}
    />
  )
}
