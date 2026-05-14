"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { DollarSign } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RegisterSaleModal } from "./register-sale-modal"

export function RegisterSaleButton({
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
        className="gap-1.5 cursor-pointer"
        style={{ background: "var(--brand)" }}
        onClick={() => setOpen(true)}
      >
        <DollarSign className="w-3.5 h-3.5" />
        {t("registerSale")}
      </Button>
      <RegisterSaleModal
        open={open}
        onClose={() => setOpen(false)}
        leadId={leadId}
        brandId={brandId}
      />
    </>
  )
}
