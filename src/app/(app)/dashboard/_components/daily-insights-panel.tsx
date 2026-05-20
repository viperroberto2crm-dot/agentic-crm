"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, ChevronRight, CheckCircle2, ListTodo, AlertCircle } from "lucide-react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  createFollowUpTask,
  markAsContacted,
} from "../_actions/daily-insights-actions"

export type DailyInsightLead = {
  id: string
  name: string
  brand_name: string
  days_stale: number
}

type Props = {
  leads: DailyInsightLead[]
}

export function DailyInsightsPanel({ leads }: Props) {
  const t = useTranslations("dashboard.dailyInsights")
  const hasLeads = leads.length > 0
  const [open, setOpen] = useState(hasLeads)
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function handleCreateFollowUp(leadId: string, leadName: string) {
    setBusyLeadId(leadId)
    startTransition(async () => {
      try {
        await createFollowUpTask(leadId, leadName)
      } finally {
        setBusyLeadId(null)
      }
    })
  }

  function handleMarkContacted(leadId: string) {
    setBusyLeadId(leadId)
    startTransition(async () => {
      try {
        await markAsContacted(leadId)
      } finally {
        setBusyLeadId(null)
      }
    })
  }

  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            {hasLeads ? (
              <AlertCircle className="w-4 h-4 text-amber-500" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            )}
            <span className="text-sm font-medium text-gray-900">
              {hasLeads
                ? t("collapsedWithCount", { count: leads.length })
                : t("collapsedAllGood")}
            </span>
          </div>
          {hasLeads && (
            <span className="text-gray-400">
              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>
          )}
        </button>

        {open && hasLeads && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
                    {t("columnLead")}
                  </th>
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">
                    {t("columnDays")}
                  </th>
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">
                    {t("columnBrand")}
                  </th>
                  <th className="text-right text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2">
                    {t("columnActions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const isBusy = busyLeadId === lead.id
                  const daysText = lead.days_stale >= 9999 ? "—" : `${lead.days_stale}d`
                  return (
                    <tr key={lead.id} className="border-b border-gray-100">
                      <td className="py-2 pr-4">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="text-gray-800 hover:text-gray-900 font-medium"
                        >
                          {lead.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-gray-600 tabular-nums">{daysText}</td>
                      <td className="py-2 pr-4 hidden md:table-cell text-xs text-gray-400">
                        {lead.brand_name}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => handleCreateFollowUp(lead.id, lead.name)}
                            className="h-7 text-[11px] gap-1 border-gray-200 text-gray-700 hover:bg-gray-100"
                          >
                            <ListTodo className="w-3 h-3" />
                            {t("actionFollowUp")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => handleMarkContacted(lead.id)}
                            className="h-7 text-[11px] gap-1 border-gray-200 text-gray-700 hover:bg-gray-100"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {t("actionContacted")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
