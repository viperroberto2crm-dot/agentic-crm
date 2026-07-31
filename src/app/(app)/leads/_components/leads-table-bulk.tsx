"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Phone, Trash2, Loader2, UserPlus, ChevronDown } from "lucide-react"
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
  brand: { id: string; name: string; slug: string; brand_color: string | null } | null
  rep: { id: string; name: string } | null
}

export type CoverageCell = {
  state: "covered" | "unknown" | "none"
  until: string | null
  hadPayment: boolean
}

type Props = {
  leads: BulkLeadRow[]
  canBulkDelete: boolean
  brandReps?: { id: string; name: string }[]
  showCompany?: boolean
  logQuickCall: (leadId: string, fd: FormData) => Promise<void>
  statusLabels: Record<LeadStatus, string>
  coverageById?: Record<string, CoverageCell>
  coverageLabels?: { covered: string; unknown: string; none: string }
  labels: {
    noLeadsFilter: string
    createNew: string
    quickCallTitle: string
    colLastContact: string
    colCompany: string
    deleteSelected: string
    deleting: string
    deleteConfirmTitle: string
    deleteConfirmDesc: string
    deleteConfirmAll: string
    cancel: string
    selectAll: string
  }
}

// Fallback dot colors by slug, mirrors brand-selector's BRAND_COLORS.
const BRAND_COLORS: Record<string, string> = {
  "si-se-pierde": "#E11D48",
  "sunny-slim": "#F59E0B",
}

// Chips de estado en pastel (fondo suave + texto + puntito), se leen de un vistazo.
const STATUS_CHIP: Record<LeadStatus, { bg: string; text: string; dot: string }> = {
  new:             { bg: "#EAF0FD", text: "#4E79D6", dot: "#5F8CE6" },
  contacted:       { bg: "#FBF1DD", text: "#B67C22", dot: "#D79A3E" },
  qualified:       { bg: "#EFEAF9", text: "#6E5AA6", dot: "#8E7CC3" },
  appointment_set: { bg: "#FCEEE4", text: "#C56A3E", dot: "#EF7B5C" },
  sold:            { bg: "#E6F3EC", text: "#2E7E5B", dot: "#3FA278" },
  lost:            { bg: "#FAEBEA", text: "#B85D5B", dot: "#D5807E" },
  on_hold:         { bg: "#F0EBE0", text: "#7C7259", dot: "#C7B48A" },
  not_interested:  { bg: "#EFEBE4", text: "#7C8B80", dot: "#A8B0A2" },
}

// Chip de cobertura de prepago: verde (cubierto) / ámbar (por confirmar) / rojo
// (sin cobertura, solo si YA pagó antes). Mismos tonos que los chips de status.
const COVERAGE_CHIP: Record<"covered" | "unknown" | "none", { bg: string; text: string; dot: string }> = {
  covered: { bg: "#E6F3EC", text: "#2E7E5B", dot: "#3FA278" },
  unknown: { bg: "#FBF1DD", text: "#B67C22", dot: "#D79A3E" },
  none:    { bg: "#FAEBEA", text: "#B85D5B", dot: "#D5807E" },
}

function CoverageChip({
  cov,
  labels,
}: {
  cov: CoverageCell
  labels: { covered: string; unknown: string; none: string }
}) {
  // "cobertura" = PLAN de prepago activo, NO "pagó". Un paciente que paga por
  // visita (one-time) y no debe nada NO se marca en rojo "Sin cobertura" (se leía
  // como "no pagó" → confusión). Solo mostramos 🟢 Cubierto y 🟡 Por confirmar.
  // "Quién debe" se resuelve aparte con un badge "Debe $X" (saldo pendiente).
  if (cov.state === "none") return null
  const c = COVERAGE_CHIP[cov.state]
  const text =
    cov.state === "covered"
      ? `${labels.covered}${cov.until ? ` · ${cov.until}` : ""}`
      : labels.unknown
  return (
    <span
      className="inline-flex items-center gap-1 h-5 px-2 rounded-full text-[11px] font-semibold whitespace-nowrap mt-1"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.dot }} />
      {text}
    </span>
  )
}

// Degradados para el avatar; se elige de forma estable por el nombre del lead.
const AVATAR_GRADS = [
  "linear-gradient(150deg,#EF7B5C,#E2653F)",
  "linear-gradient(150deg,#3FA278,#2C6B57)",
  "linear-gradient(150deg,#5F8CE6,#3E63B8)",
  "linear-gradient(150deg,#E0A64E,#C88A2E)",
  "linear-gradient(150deg,#8E7CC3,#6E5AA6)",
  "linear-gradient(150deg,#D5807E,#B85D5B)",
]

function avatarGrad(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_GRADS[h % AVATAR_GRADS.length]
}

function initials(first: string, last: string | null): string {
  const a = first?.trim()?.[0] ?? ""
  const b = last?.trim()?.[0] ?? ""
  return (a + b || a || "?").toUpperCase()
}

function LeadAvatar({ first, last, id }: { first: string; last: string | null; id: string }) {
  return (
    <span
      aria-hidden
      className="w-10 h-10 rounded-[13px] shrink-0 grid place-items-center text-white font-semibold text-[14px] shadow-[0_2px_6px_rgba(18,60,48,0.14)] select-none"
      style={{ background: avatarGrad(id || `${first}${last ?? ""}`) }}
    >
      {initials(first, last)}
    </span>
  )
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
  if (score === null) return <span className="text-[#C9C0AF] text-xs">—</span>
  return (
    <div className="flex items-center gap-2 justify-start">
      <div className="w-11 h-1.5 rounded-full bg-[#EFE8DA] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${score}%`, background: "linear-gradient(90deg,#E0A64E,#EF7B5C)" }}
        />
      </div>
      <span className="text-[12px] font-bold text-[#20342C] tabular-nums w-5 text-right">{score}</span>
    </div>
  )
}

export function LeadsTableBulk({
  leads,
  canBulkDelete,
  brandReps = [],
  showCompany = false,
  logQuickCall,
  statusLabels,
  coverageById,
  coverageLabels,
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
            <tr className="border-b border-[#ECE3D3]">
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
              <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4 min-w-[180px]">
                Lead
              </th>
              {showCompany && (
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4">
                  {labels.colCompany}
                </th>
              )}
              <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4">
                Status
              </th>
              <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">
                Rep
              </th>
              <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4 hidden sm:table-cell">
                {labels.colLastContact}
              </th>
              <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 hidden lg:table-cell">
                Score
              </th>
              <th className="pb-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const chip = STATUS_CHIP[lead.status] ?? STATUS_CHIP.new
              const isSelected = selected.has(lead.id)
              return (
                <tr
                  key={lead.id}
                  className={`border-b border-[#F1EADD] transition-colors group ${
                    isSelected ? "bg-[#FBF6EC]" : "hover:bg-[#FBF6EC]"
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
                    <div className="flex items-center gap-3 min-w-0">
                      <LeadAvatar first={lead.first_name} last={lead.last_name} id={lead.id} />
                      <div className="min-w-0">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="font-semibold text-[15px] text-[#20342C] hover:text-[#12483B] transition-colors block leading-tight truncate"
                        >
                          {lead.first_name} {lead.last_name ?? ""}
                        </Link>
                        <span className="text-[11.5px] text-[#93A39D] tabular-nums">{lead.phone}</span>
                        {coverageById && coverageLabels && coverageById[lead.id] && (
                          <div className="leading-none">
                            <CoverageChip cov={coverageById[lead.id]} labels={coverageLabels} />
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {showCompany && (
                    <td className="py-3 pr-4">
                      {lead.brand ? (
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor:
                                lead.brand.brand_color ??
                                BRAND_COLORS[lead.brand.slug] ??
                                "#3B82F6",
                            }}
                          />
                          <span className="text-[13px] text-[#5C6F68] truncate max-w-[140px]">
                            {lead.brand.name}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  )}

                  <td className="py-3 pr-4">
                    <span
                      className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap"
                      style={{ backgroundColor: chip.bg, color: chip.text }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: chip.dot }} />
                      {statusLabels[lead.status] ?? lead.status}
                    </span>
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
                    {/* tel: link interim — abre dialer del dispositivo.
                        Cuando se integre Twilio, esto vuelve a ser un botón que dispara
                        llamada via API + webhook registra la call automáticamente. */}
                    {lead.phone ? (
                      <a
                        href={`tel:${lead.phone}`}
                        title={labels.quickCallTitle}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-zinc-700"
                      >
                        <Phone className="w-3.5 h-3.5" />
                      </a>
                    ) : null}
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
