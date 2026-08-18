"use client"

import { useState, useTransition } from "react"
import { PhoneCall, Loader2 } from "lucide-react"
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
import { startBotCall } from "../actions"

export function BotCallButton({
  leadId,
  brandId,
  name,
}: {
  leadId: string
  brandId: string
  name: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  function call() {
    setNotice(null)
    startTransition(async () => {
      const r = await startBotCall({ lead_id: leadId, brand_id: brandId })
      if (r.ok) {
        setNotice({ ok: true, text: "Llamada iniciada — el bot está marcando." })
        setOpen(false)
      } else {
        setNotice({ ok: false, text: r.error })
      }
    })
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-9 gap-1.5 cursor-pointer border-[#2E8B6F]/40 text-[#2E7E5B] hover:bg-[#E6F3EC] hover:text-[#20342C]"
        onClick={() => setOpen(true)}
        title="Llamar al paciente con el asistente de voz"
      >
        <PhoneCall className="w-3.5 h-3.5" />
        Llamar con el bot
      </Button>

      {notice && (
        <span className={`text-xs ${notice.ok ? "text-[#2E7E5B]" : "text-red-500"}`}>{notice.text}</span>
      )}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="bg-white border-gray-200 text-gray-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-gray-900">
              ¿Llamar a {name || "este paciente"} con el bot?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-500">
              El asistente de voz marcará al paciente ahora. Recuerda: por ley (TCPA) solo
              llama entre <b>8am y 9pm</b> hora del paciente, y respeta a quien pidió no ser
              llamado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-gray-300 text-gray-500 hover:text-gray-800 bg-transparent hover:bg-gray-100"
              disabled={pending}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                call()
              }}
              disabled={pending}
              className="bg-[#2E8B6F] hover:bg-[#277a61] text-white border-0 cursor-pointer gap-1.5"
            >
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneCall className="w-3.5 h-3.5" />}
              {pending ? "Llamando…" : "Llamar ahora"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
