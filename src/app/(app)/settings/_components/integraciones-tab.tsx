"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import {
  CreditCard, Phone, MessageCircle, Server, Stethoscope, Megaphone,
  ExternalLink, Loader2, Check, X, type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { testIntegrationAction } from "../_actions/integrations-actions"
import type { IntegrationKey, IntegrationHealth, IntegrationStatus } from "@/lib/integrations/health"

type Props = {
  statuses: Record<IntegrationKey, IntegrationHealth>
}

const SERVICES: {
  key: IntegrationKey
  icon: LucideIcon
  testable: boolean
  manageHref?: string
}[] = [
  { key: "stripe", icon: CreditCard, testable: true, manageHref: "/settings?tab=ofertas" },
  { key: "square", icon: CreditCard, testable: true, manageHref: "/settings?tab=ofertas" },
  { key: "meta", icon: Megaphone, testable: true },
  { key: "eighthundred", icon: Phone, testable: true, manageHref: "/settings?tab=tracking" },
  { key: "practicebetter", icon: Stethoscope, testable: true, manageHref: "/settings?tab=servicios-pb" },
  { key: "twilio", icon: MessageCircle, testable: true },
  { key: "whatsapp", icon: MessageCircle, testable: false },
  { key: "hermes_vps", icon: Server, testable: false },
]

const PILL: Record<IntegrationStatus, string> = {
  connected: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  none: "bg-red-50 text-red-700 border-red-200",
  soon: "bg-gray-100 text-gray-500 border-gray-200",
}

export function IntegracionesTab({ statuses }: Props) {
  const t = useTranslations("settings.integrations")

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground max-w-prose">{t("subtitle")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {SERVICES.map((svc) => (
          <IntegrationCard key={svc.key} svc={svc} health={statuses[svc.key]} t={t} />
        ))}
      </div>
    </div>
  )
}

function IntegrationCard({
  svc,
  health,
  t,
}: {
  svc: (typeof SERVICES)[number]
  health: IntegrationHealth
  t: ReturnType<typeof useTranslations>
}) {
  const Icon = svc.icon
  const [pending, startTransition] = useTransition()
  const [tested, setTested] = useState<{ ok: boolean; detail: string } | null>(null)

  const pillLabel =
    health.status === "connected" ? t("stConnected")
    : health.status === "partial" ? t("stPartial")
    : health.status === "none" ? t("stNone")
    : t("stSoon")

  function handleTest() {
    setTested(null)
    startTransition(async () => {
      const r = await testIntegrationAction(svc.key)
      setTested(r)
    })
  }

  return (
    <div className="rounded-lg border border-border bg-white p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-md bg-secondary flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-foreground" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{t(`${svc.key}Label`)}</p>
            <p className="text-xs text-muted-foreground line-clamp-2">{t(`${svc.key}Desc`)}</p>
          </div>
        </div>
        <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${PILL[health.status]}`}>
          {pillLabel}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">{health.detail}</p>

      {tested && (
        <p className={`text-xs flex items-center gap-1.5 ${tested.ok ? "text-emerald-700" : "text-red-600"}`}>
          {tested.ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
          {tested.detail}
        </p>
      )}

      <div className="flex items-center gap-2 mt-auto pt-1">
        {svc.manageHref && (
          <Link
            href={svc.manageHref}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {t("manage")} <ExternalLink className="w-3 h-3" />
          </Link>
        )}
        {svc.testable && health.status !== "none" && health.status !== "soon" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs ml-auto gap-1.5"
            onClick={handleTest}
            disabled={pending}
          >
            {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {pending ? t("testing") : t("test")}
          </Button>
        )}
      </div>
    </div>
  )
}
