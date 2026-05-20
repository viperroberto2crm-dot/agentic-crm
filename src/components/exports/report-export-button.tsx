"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { FileSpreadsheet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ReportExportDialog, type ReportExportParams } from "./report-export-dialog"

type Props = {
  /** Marca activa actual (slug del switcher global). "" para "Todas". */
  defaultBrand?: string
}

export function ReportExportButton({ defaultBrand = "" }: Props) {
  const t = useTranslations("exports.report")
  const [open, setOpen] = useState(false)

  function handleConfirm(params: ReportExportParams) {
    const qs = new URLSearchParams()
    if (params.brand) qs.set("brand", params.brand)
    if (params.historico) {
      qs.set("historico", "true")
    } else {
      if (params.from) qs.set("from", params.from)
      if (params.to) qs.set("to", params.to)
    }
    const href = `/api/exports/report?${qs.toString()}`

    // Anchor transient para que el browser respete Content-Disposition
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
        <FileSpreadsheet className="w-3.5 h-3.5" />
        {t("buttonLabel")}
      </Button>

      <ReportExportDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={handleConfirm}
        defaultBrand={defaultBrand}
      />
    </>
  )
}
