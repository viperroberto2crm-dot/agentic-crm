"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ArrowRightLeft, GitMerge, X } from "lucide-react"
import { formatDate } from "@/lib/datetime"
import type { BrandOption } from "./link-lead-dialog"
import type { UnassignedLead } from "../_actions/external-unlinked-actions"
import {
  reassignLeadToBrand,
  mergeUnassignedLeadInto,
} from "../_actions/external-unlinked-actions"

type Props = {
  leads: UnassignedLead[]
  brands: BrandOption[]
  defaultBrandId: string | null
}

type Conflict = { existingLeadId: string; existingName: string }

function displayName(l: UnassignedLead): string {
  return [l.first_name, l.last_name].filter(Boolean).join(" ").trim() || "(sin nombre)"
}

/** Una fila con su propio estado (marca elegida, cargando, conflicto, mensaje). */
function LeadRow({
  lead,
  brands,
  defaultBrandId,
}: {
  lead: UnassignedLead
  brands: BrandOption[]
  defaultBrandId: string | null
}) {
  const router = useRouter()
  const [brandId, setBrandId] = useState<string>(defaultBrandId ?? "")
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)

  async function onReassign() {
    if (!brandId) {
      setMsg("Elige una clínica")
      return
    }
    setLoading(true)
    setMsg(null)
    setConflict(null)
    try {
      const res = await reassignLeadToBrand(lead.id, brandId)
      if (!res.ok) {
        setMsg(res.error)
      } else if ("conflict" in res && res.conflict) {
        setConflict(res.conflict)
      } else {
        setMsg("Reasignado ✓")
        router.refresh()
      }
    } finally {
      setLoading(false)
    }
  }

  async function onMerge() {
    if (!conflict) return
    setLoading(true)
    setMsg(null)
    try {
      const res = await mergeUnassignedLeadInto(lead.id, conflict.existingLeadId)
      if (res.ok) {
        setMsg("Fusionado ✓")
        router.refresh()
      } else {
        setMsg(res.error)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <tr className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors align-top">
      <td className="px-3 py-2.5 text-foreground">
        <span className="block truncate max-w-[180px] font-medium">{displayName(lead)}</span>
        <span className="block text-xs text-muted-foreground truncate max-w-[180px]">
          {lead.email || lead.phone || ""}
        </span>
      </td>
      <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell text-xs capitalize">
        {lead.source || "—"}
      </td>
      <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell whitespace-nowrap tabular-nums text-xs">
        {formatDate(lead.created_at)}
      </td>
      <td className="px-3 py-2.5">
        {conflict ? (
          <div className="flex flex-col items-end gap-1.5">
            <p className="text-xs text-amber-600 dark:text-amber-500 text-right max-w-[240px]">
              Ya existe <strong>{conflict.existingName}</strong> en esa clínica.
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs gap-1"
                disabled={loading}
                onClick={() => setConflict(null)}
              >
                <X className="w-3.5 h-3.5" />
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-xs gap-1"
                disabled={loading}
                onClick={onMerge}
              >
                <GitMerge className="w-3.5 h-3.5" />
                Vincular al existente
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1.5">
            {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              disabled={loading}
              className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            >
              <option value="">Clínica…</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name ?? "—"}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-xs gap-1"
              disabled={loading}
              onClick={onReassign}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              Reasignar
            </Button>
          </div>
        )}
      </td>
    </tr>
  )
}

export function UnassignedLeadsTable({ leads, brands, defaultBrandId }: Props) {
  if (leads.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-8 text-center">
        <p className="text-sm text-muted-foreground">No hay leads sin asignar.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/40">
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Lead</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">
              Origen
            </th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">
              Fecha
            </th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <LeadRow key={lead.id} lead={lead} brands={brands} defaultBrandId={defaultBrandId} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
