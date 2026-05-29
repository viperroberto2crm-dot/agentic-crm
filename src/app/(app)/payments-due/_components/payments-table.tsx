"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

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
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={labels.searchPlaceholder}
            className="pl-8 h-9 bg-white border-gray-200 text-sm"
          />
        </div>
        {q && (
          <p className="text-xs text-gray-400">
            {filtered.length} {labels.records}
          </p>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">{labels.empty}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
                  {labels.colLead}
                </th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">
                  {labels.product}
                </th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
                  {labels.nextPaymentAmount}
                </th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
                  {labels.dueOn}
                </th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
                  {labels.daysRemaining}
                </th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 hidden lg:table-cell">
                  {labels.progress}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isOverdue = row.daysRemaining < 0
                const isSoon = row.daysRemaining >= 0 && row.daysRemaining <= 3
                return (
                  <tr
                    key={row.planId}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <td className="py-3 pr-4">
                      <Link
                        href={`/leads/${row.leadId}`}
                        className="text-gray-800 hover:text-gray-900 font-medium"
                      >
                        {row.leadName}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 hidden md:table-cell">
                      <span className="text-xs text-gray-500">{row.productName}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-gray-900 font-medium tabular-nums">
                        {fmtCents(row.nextAmountCents)}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-xs text-gray-500 font-mono">
                        {fmtDate(row.nextDueDate)}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {isOverdue ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 font-normal border-red-500/40 text-red-500"
                        >
                          {Math.abs(row.daysRemaining)} {labels.daysOverdue}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 font-normal ${
                            isSoon
                              ? "border-amber-500/40 text-amber-600"
                              : "border-zinc-600 text-gray-500"
                          }`}
                        >
                          {row.daysRemaining} {labels.daysRemainingShort}
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 hidden lg:table-cell">
                      <span className="text-xs text-gray-400 tabular-nums">
                        {row.paidCount} / {row.totalCount}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
