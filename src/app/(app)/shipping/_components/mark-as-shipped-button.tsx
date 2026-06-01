"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Loader2, Package } from "lucide-react"
import { markAsShipped } from "../../appointments/actions"

export function MarkAsShippedButton({ appointmentId }: { appointmentId: string }) {
  const t = useTranslations("shipping")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await markAsShipped(appointmentId)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : t("genericError"))
        setConfirming(false)
      }
    })
  }

  if (confirming && !isPending) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleClick}
            className="h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
          >
            {t("confirmShip")}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false)
              setError(null)
            }}
            className="h-8 px-2.5 rounded-md text-xs text-gray-500 hover:bg-gray-100"
          >
            {t("cancel")}
          </button>
        </div>
        {error && <p className="text-[10px] text-red-500">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="h-9 px-3 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Package className="w-3.5 h-3.5" />
        )}
        {isPending ? t("shipping") : t("markShipped")}
      </button>
      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  )
}
