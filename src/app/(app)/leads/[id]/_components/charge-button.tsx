"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { CreditCard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChargeModal } from "./charge-modal"

export function ChargeButton({
  leadId,
  brandId,
}: {
  leadId: string
  brandId: string
}) {
  const t = useTranslations("sales")
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-9 gap-1.5 cursor-pointer border-gray-300 text-gray-700 hover:text-gray-900 hover:bg-gray-100"
        onClick={() => setOpen(true)}
      >
        <CreditCard className="w-3.5 h-3.5" />
        {t("charge")}
      </Button>
      <ChargeModal
        open={open}
        onClose={() => setOpen(false)}
        leadId={leadId}
        brandId={brandId}
      />
    </>
  )
}
