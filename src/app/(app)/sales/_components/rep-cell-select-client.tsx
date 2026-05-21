"use client"

import { RepCellSelect, type RepOption } from "@/components/ui/rep-cell-select"
import { reassignSaleRep } from "../../leads/[id]/actions"

export function RepCellSelectClient({
  saleId,
  leadId,
  currentRepId,
  currentRepName,
  reps,
  canEdit,
}: {
  saleId: string
  leadId: string | null
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
      onReassign={(newRepId) => reassignSaleRep(saleId, newRepId, leadId ?? "")}
    />
  )
}
