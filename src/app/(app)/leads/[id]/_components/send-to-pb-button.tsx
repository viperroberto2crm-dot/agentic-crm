"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, UserPlus } from "lucide-react"
import { sendLeadToPracticeBetter } from "../actions"

export function SendToPbButton({ leadId }: { leadId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const res = await sendLeadToPracticeBetter(leadId)
      if (res.ok) router.refresh()
      else setError(res.error ?? "Error")
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-[#0E5F4C] hover:bg-[#0A4538] text-white text-xs font-medium disabled:opacity-50 w-fit"
      >
        {isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <UserPlus className="w-3.5 h-3.5" />
        )}
        {isPending ? "Creando…" : "Crear paciente en Practice Better"}
      </button>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
