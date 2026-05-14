"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ExportDateRangeDialog } from "./export-date-range-dialog"

type Props = {
  /** Entity to export — controls the endpoint and default title. */
  entity: "sales" | "calls" | "leads"
  /** Additional query params (status, outcome, etc.) preserved on the export. */
  extraParams?: Record<string, string | null | undefined>
  /** Optional override for the trigger button label. */
  label?: string
}

export function ExportButton({ entity, extraParams, label }: Props) {
  const t = useTranslations("exports")
  const [open, setOpen] = useState(false)

  function handleConfirm(from: string, to: string) {
    const qs = new URLSearchParams()
    qs.set("from", from)
    qs.set("to", to)
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        if (v) qs.set(k, v)
      }
    }
    const href = `/api/exports/${entity}?${qs.toString()}`
    // Trigger a download via a transient anchor so the browser respects
    // Content-Disposition and does not navigate away.
    const a = document.createElement("a")
    a.href = href
    a.rel = "noopener"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-9 text-xs gap-1.5 cursor-pointer border-gray-300 text-gray-700 hover:text-gray-900 hover:bg-gray-100"
      >
        <Download className="w-3.5 h-3.5" />
        {label ?? t("exportButton")}
      </Button>

      <ExportDateRangeDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={handleConfirm}
      />
    </>
  )
}
