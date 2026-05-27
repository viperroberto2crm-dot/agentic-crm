"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Phone, Trash2, Loader2, UserPlus, ChevronDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTranslations } from "next-intl"
import { bulkDeleteLeads, bulkAssignLeadsRep } from "../actions"

type LeadStatus =
  | "new" | "contacted" | "qualified" | "appointment_set"
  | "sold" | "lost" | "on_hold" | "not_interested"

export type BulkLeadRow = {
  id: string
  first_name: string
  last_name: string | null
  phone: string
  status: LeadStatus
  ai_score: number | null
  last_contacted_at: string | null
  rep: { id: string; name: string } | null
}

type Props = {
  leads: BulkLeadRow[]
  canBulkDelete: boolean
  brandReps?: { id: string; name: string }[]
  logQuickCall: (leadId: string, fd: FormData) => Promise<void>
  statusLabels: Record<LeadStatus, string>
  labels: {
    noLeadsFilter: string
    createNew: string
    quickCallTitle: string
    colLastContact: string
    deleteSelected: string
    deleting: string
    deleteConfirmTitle: string
    deleteConfirmDesc: string
    deleteConfirmAll: string
    cancel: string
    selectAll: string
  }
}

const STATUS_CLASS: Record<LeadStatus, string> = {
  new:             "border-gray-300 text-gray-500",
  contacted:       "border-blue-500/40 text-blue-400",
  qualified:       "border-violet-500/40 text-violet-400",
  appointment_set: "border-amber-500/40 text-amber-400",
  sold:            "border-emerald-500/40 text-emerald-400",
  lost:            "border-red-500/40 text-red-500",
  on_hold:         "border-yellow-500/40 text-yellow-500",
  not_interested:  "border-zinc-500/40 text-gray-500",
}

function daysAgoLocal(iso: string | null): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  if (days === 0) return "hoy"
  if (days === 1) return "1d"
  return `${days}d`
}

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-300 text-xs">—</span>
  const color = score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500"
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-10 h-1 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] text-gray-400 tabular-nums">{score}</span>
    </div>
  )
}

export function LeadsTableBulk({
  leads,
  canBulkDelete,
  brandReps = [],
  logQuickCall,
  statusLabels,
  labels,
}: Props) {
  const tc = useTranslations("common")
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const allIds = useMemo(() => leads.map((l) => l.id), [leads])
  const allSelected = selected.size > 0 && selected.size === leads.length
  const someSelected = selected.size > 0 && selected.size < leads.length

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => {
      if (prev.size === leads.length) return new Set()
      return new Set(allIds)
    })
  }

  function handleBulkDelete() {
    setError(null)
    const ids = Array.from(selected)
    startTransition(async () => {
      const result = await bulkDeleteLeads(ids)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSelected(new Set())
      setConfirmOpen(false)
      router.refresh()
    })
  }

  function handleBulkAssign(newRepId: string) {
    setError(null)
    const ids = Array.from(selected)
    startTransition(async () => {
      const result = await bulkAssignLeadsRep(ids, newRepId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSelected(new Set())
      router.refresh()
    })
  }

  if (leads.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-gray-400">
        {labels.noLeadsFilter}{" "}
        <Link
          href="/leads/new"
          className="text-gray-500 underline underline-offset-2 hover:text-gray-900"
        >
          {labels.createNew}
        </Link>
      </div>
    )
  }

  return (
    <>
      {/* Bulk actions bar — solo aparece cuando hay selección */}
      {canBulkDelete && selected.size > 0 && (
        <div className="sticky top-2 z-10 mb-2 flex items-center justify-between gap-3 bg-gray-900 text-white rounded-lg px-4 py-2.5 shadow-lg">
          <span className="text-sm font-medium">
            {selected.size} {selected.size === 1 ? "lead seleccionado" : "leads seleccionados"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-gray-300 hover:text-white hover:bg-gray-800 cursor-pointer"
              onClick={() => setSelected(new Set())}
              disabled={isPending}
            >
              {labels.cancel}
            </Button>
            {brandReps.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs gap-1.5 text-white hover:bg-gray-800 cursor-pointer border border-gray-700"
                    disabled={isPending}
                  >
                    {isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="w-3.5 h-3.5" />
                    )}
                    Asignar a
                    <ChevronDown className="w-3 h-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 bg-white border-gray-200 max-h-60 overflow-y-auto">
                  {brandReps.map((r) => (
                    <DropdownMenuItem
                      key={r.id}
                      onClick={() => handleBulkAssign(r.id)}
                      disabled={isPending}
                      className="text-xs cursor-pointer text-gray-700"
                    >
                      {r.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-red-600 hover:bg-red-700 text-white cursor-pointer"
              onClick={() => setConfirmOpen(true)}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              {labels.deleteSelected}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="mb-2 text-xs text-red-500 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              {canBulkDelete && (
                <th className="text-left pb-2 pr-2 w-8">
                  <input
                    type="checkbox"
                    aria-label={labels.selectAll}
                    title={labels.selectAll}
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected
                    }}
                    onChange={toggleAll}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-gray-400 cursor-pointer"
                  />
                </th>
              )}
              <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 min-w-[180px]">
                Lead
              </th>
              <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
                Status
              </th>
              <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">
                Rep
              </th>
              <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden sm:table-cell">
                {labels.colLastContact}
              </th>
              <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 hidden lg:table-cell">
                Score
              </th>
              <th className="pb-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const cfg = STATUS_CLASS[lead.status] ?? "border-gray-300 text-gray-500"
              const isSelected = selected.has(lead.id)
              return (
                <tr
                  key={lead.id}
                  className={`border-b border-gray-100 transition-colors group ${
                    isSelected ? "bg-gray-50" : "hover:bg-gray-50"
                  }`}
                >
                  {canBulkDelete && (
                    <td className="py-3 pr-2 w-8">
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${lead.first_name}`}
                        checked={isSelected}
                        onChange={() => toggleOne(lead.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-gray-400 cursor-pointer"
                      />
                    </td>
                  )}

                  <td className="py-3 pr-4">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-medium text-gray-800 hover:text-gray-900 transition-colors block leading-tight"
                    >
                      {lead.first_name} {lead.last_name ?? ""}
                    </Link>
                    <span className="text-[11px] text-gray-400 font-mono">{lead.phone}</span>
                  </td>

                  <td className="py-3 pr-4">
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-normal ${cfg}`}>
                      {statusLabels[lead.status] ?? lead.status}
                    </Badge>
                  </td>

                  <td className="py-3 pr-4 hidden md:table-cell">
                    <span className="text-xs text-gray-400">{lead.rep?.name ?? "—"}</span>
                  </td>

                  <td className="py-3 pr-4 hidden sm:table-cell">
                    <span className="text-xs text-gray-400">{daysAgoLocal(lead.last_contacted_at)}</span>
                  </td>

                  <td className="py-3 hidden lg:table-cell">
                    <ScoreBar score={lead.ai_score} />
                  </td>

                  <td className="py-3 w-8">
                    <form action={logQuickCall.bind(null, lead.id)}>
                      <button
                        type="submit"
                        title={labels.quickCallTitle}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-zinc-700 cursor-pointer"
                      >
                        <Phone className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-white border-gray-200 text-gray-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-gray-900">
              {labels.deleteConfirmTitle.replace("{count}", String(selected.size))}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-500">
              {labels.deleteConfirmDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-gray-300 text-gray-500 hover:text-gray-800 bg-transparent hover:bg-gray-100"
              disabled={isPending}
            >
              {tc("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleBulkDelete()
              }}
              disabled={isPending}
              className="bg-red-600 hover:bg-red-700 text-white border-0 cursor-pointer"
            >
              {isPending ? labels.deleting : labels.deleteConfirmAll}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
