"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { CheckCircle2, ArrowDown, X } from "lucide-react"

export function JustCreatedBanner() {
  const t = useTranslations("leads")
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  return (
    <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
      <div className="flex-1">
        <span className="font-medium">{t("justCreatedTitle")}</span>
        <span className="text-emerald-700/80 ml-1.5">{t("justCreatedHint")}</span>
      </div>
      <ArrowDown className="w-4 h-4 shrink-0 text-emerald-600 animate-bounce" />
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-emerald-600/60 hover:text-emerald-700 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
