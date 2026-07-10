"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"

export type PaymentDueRow = {
  planId: string
  leadId: string
  leadName: string
  productName: string
  nextAmountCents: number
  nextDueDate: string
  daysRemaining: number
  paidCount: number
  totalCount: number
}

type Labels = {
  empty: string
  colLead: string
  product: string
  nextPaymentAmount: string
  dueOn: string
  daysRemaining: string
  daysRemainingShort: string
  daysOverdue: string
  progress: string
  searchPlaceholder: string
  records: string
}

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function fmtDate(iso: string) {
  const d = new Date(iso + "T12:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// Degradados para el avatar; se elige de forma estable por el nombre del lead.
const GRADS = [
  "linear-gradient(150deg,#EF7B5C,#E2653F)",
  "linear-gradient(150deg,#3FA278,#2C6B57)",
  "linear-gradient(150deg,#5F8CE6,#3E63B8)",
  "linear-gradient(150deg,#E0A64E,#C88A2E)",
  "linear-gradient(150deg,#8E7CC3,#6E5AA6)",
  "linear-gradient(150deg,#D5807E,#B85D5B)",
]

function grad(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return GRADS[h % GRADS.length]
}

function initials(n: string): string {
  const p = (n || "?").trim().split(/\s+/)
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "") || "?").toUpperCase()
}

// Chips en pastel — se leen de un vistazo. Rojo = vencido, amber = próximo,
// verde suave = en tiempo (con margen).
const CHIP_OVERDUE = { bg: "#FAEBEA", text: "#B85D5B", dot: "#D5807E" }
const CHIP_SOON = { bg: "#FBF1DD", text: "#B67C22", dot: "#D79A3E" }
const CHIP_ONTIME = { bg: "#E6F3EC", text: "#2E7E5B", dot: "#3FA278" }

export function PaymentsTable({
  rows,
  labels,
}: {
  rows: PaymentDueRow[]
  labels: Labels
}) {
  const [q, setQ] = useState("")

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(
      (r) =>
        r.leadName.toLowerCase().includes(term) ||
        r.productName.toLowerCase().includes(term),
    )
  }, [rows, q])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#93A39D] pointer-events-none" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={labels.searchPlaceholder}
            className="pl-9 h-9 rounded-full bg-card border-[#ECE3D3] text-[#20342C] placeholder:text-[#93A39D] text-sm shadow-[0_1px_2px_rgba(26,46,40,0.05)] focus-visible:ring-[#12483B]/25"
          />
        </div>
        {q && (
          <p className="text-xs text-[#93A39D] tabular-nums">
            {filtered.length} {labels.records}
          </p>
        )}
      </div>

      <div className="bg-card border border-[#ECE3D3] rounded-2xl px-4 py-1 shadow-[0_1px_2px_rgba(26,46,40,0.05),0_10px_28px_-14px_rgba(26,46,40,0.12)]">
        {filtered.length === 0 ? (
          <p className="text-sm text-[#93A39D] py-12 text-center">{labels.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#ECE3D3]">
                  <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest py-3 pr-4 min-w-[200px]">
                    {labels.colLead}
                  </th>
                  <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest py-3 pr-4 hidden md:table-cell">
                    {labels.product}
                  </th>
                  <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest py-3 pr-4">
                    {labels.nextPaymentAmount}
                  </th>
                  <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest py-3 pr-4">
                    {labels.dueOn}
                  </th>
                  <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest py-3 pr-4">
                    {labels.daysRemaining}
                  </th>
                  <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest py-3 hidden lg:table-cell">
                    {labels.progress}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isOverdue = row.daysRemaining < 0
                  const isSoon = row.daysRemaining >= 0 && row.daysRemaining <= 3
                  const chip = isOverdue ? CHIP_OVERDUE : isSoon ? CHIP_SOON : CHIP_ONTIME
                  const chipLabel = isOverdue
                    ? `${Math.abs(row.daysRemaining)} ${labels.daysOverdue}`
                    : `${row.daysRemaining} ${labels.daysRemainingShort}`
                  return (
                    <tr
                      key={row.planId}
                      className="border-b border-[#F1EADD] hover:bg-[#FBF6EC] transition-colors"
                    >
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            aria-hidden
                            className="w-10 h-10 rounded-[13px] shrink-0 grid place-items-center text-white font-semibold text-[14px] shadow-[0_2px_6px_rgba(18,60,48,0.14)] select-none"
                            style={{ background: grad(row.leadName) }}
                          >
                            {initials(row.leadName)}
                          </span>
                          <Link
                            href={`/leads/${row.leadId}`}
                            className="font-semibold text-[15px] text-[#20342C] hover:text-[#12483B] transition-colors truncate leading-tight"
                          >
                            {row.leadName}
                          </Link>
                        </div>
                      </td>
                      <td className="py-3 pr-4 hidden md:table-cell">
                        <span className="text-[13px] text-[#5C6F68]">{row.productName}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-[15px] text-[#20342C] font-semibold tabular-nums">
                          {fmtCents(row.nextAmountCents)}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-[13px] text-[#5C6F68] tabular-nums whitespace-nowrap">
                          {fmtDate(row.nextDueDate)}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap"
                          style={{ backgroundColor: chip.bg, color: chip.text }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: chip.dot }} />
                          {chipLabel}
                        </span>
                      </td>
                      <td className="py-3 hidden lg:table-cell">
                        <span className="text-[13px] text-[#93A39D] tabular-nums">
                          {row.paidCount} / {row.totalCount}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
