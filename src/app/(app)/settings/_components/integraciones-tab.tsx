"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  CreditCard, Phone, MessageCircle, Server, Stethoscope, Megaphone,
  ExternalLink, Loader2, Check, X, Plug, CheckCircle2, AlertTriangle, type LucideIcon,
} from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  testIntegrationAction, saveConnectionAction, clearConnectionAction,
} from "../_actions/integrations-actions"
import { CONNECTORS } from "@/lib/integrations/connectors"
import type { IntegrationKey, IntegrationHealth, IntegrationStatus } from "@/lib/integrations/health"

type Props = { statuses: Record<IntegrationKey, IntegrationHealth> }

type ServiceDef = {
  key: IntegrationKey
  icon: LucideIcon
  /** Color de marca del servicio (tile + acento). */
  color: string
  testable: boolean
  manageHref?: string
}

const SERVICES: ServiceDef[] = [
  { key: "stripe", icon: CreditCard, color: "#635BFF", testable: true, manageHref: "/settings?tab=ofertas" },
  { key: "square", icon: CreditCard, color: "#1F2937", testable: true, manageHref: "/settings?tab=ofertas" },
  { key: "meta", icon: Megaphone, color: "#1877F2", testable: true },
  { key: "eighthundred", icon: Phone, color: "#0EA5E9", testable: true, manageHref: "/settings?tab=tracking" },
  { key: "practicebetter", icon: Stethoscope, color: "#16A34A", testable: true, manageHref: "/settings?tab=servicios-pb" },
  { key: "twilio", icon: MessageCircle, color: "#F22F46", testable: true },
  { key: "whatsapp", icon: MessageCircle, color: "#25D366", testable: true },
  { key: "hermes_vps", icon: Server, color: "#6366F1", testable: false },
]

const DOT: Record<IntegrationStatus, string> = {
  connected: "#10B981",
  partial: "#F59E0B",
  none: "#EF4444",
  soon: "#9CA3AF",
}

export function IntegracionesTab({ statuses }: Props) {
  const t = useTranslations("settings.integrations")
  const connectedCount = SERVICES.filter((s) => statuses[s.key]?.status === "connected").length
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-prose">{t("subtitle")}</p>
        <span className="text-xs font-medium text-muted-foreground shrink-0 tabular-nums">
          {t("connectedCount", { n: connectedCount, total: SERVICES.length })}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
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
  svc: ServiceDef
  health: IntegrationHealth
  t: ReturnType<typeof useTranslations>
}) {
  const Icon = svc.icon
  const [pending, startTransition] = useTransition()
  const [tested, setTested] = useState<{ ok: boolean; detail: string } | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const connector = CONNECTORS[svc.key]

  const statusText =
    health.status === "connected" ? t("stConnected")
    : health.status === "partial" ? t("stPartial")
    : health.status === "none" ? t("stNone")
    : t("stSoon")

  function handleTest() {
    setTested(null)
    startTransition(async () => setTested(await testIntegrationAction(svc.key)))
  }

  return (
    <div className="group rounded-xl border border-border bg-white p-4 flex flex-col gap-3.5 transition-shadow hover:shadow-sm">
      <div className="flex items-start gap-3">
        {/* Tile de marca con indicador de estado */}
        <div className="relative shrink-0">
          <span
            className="w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ background: `${svc.color}14`, color: svc.color }}
          >
            <Icon className="w-5 h-5" />
          </span>
          <span
            className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white"
            style={{ background: DOT[health.status] }}
            aria-hidden="true"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground truncate">{t(`${svc.key}Label`)}</p>
            <span
              className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium"
              style={{ color: DOT[health.status] }}
            >
              {health.status === "connected" && <CheckCircle2 className="w-3 h-3" />}
              {health.status === "partial" && <AlertTriangle className="w-3 h-3" />}
              {statusText}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t(`${svc.key}Desc`)}</p>
        </div>
      </div>

      {health.status !== "connected" && health.status !== "soon" && (
        <p className="text-xs text-muted-foreground -mt-1">{health.detail}</p>
      )}

      {tested && (
        <p className={`text-xs flex items-center gap-1.5 ${tested.ok ? "text-emerald-700" : "text-red-600"}`}>
          {tested.ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
          {tested.detail}
        </p>
      )}

      <div className="flex items-center gap-2 mt-auto pt-1 border-t border-border/60">
        {connector?.connectable ? (
          <Button
            size="sm"
            variant={health.status === "connected" ? "outline" : "default"}
            className="h-8 px-2.5 text-xs gap-1.5 cursor-pointer mt-2"
            style={health.status === "connected" ? undefined : { background: "var(--brand)" }}
            onClick={() => setConnectOpen(true)}
          >
            <Plug className="w-3.5 h-3.5" />
            {health.status === "connected" ? t("reconnect") : t("connect")}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground mt-2">{t("comingSoon")}</span>
        )}
        {svc.manageHref && (
          <Link
            href={svc.manageHref}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
          >
            {t("manage")} <ExternalLink className="w-3 h-3" />
          </Link>
        )}
        {svc.testable && health.status !== "none" && health.status !== "soon" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 text-xs ml-auto gap-1.5 text-muted-foreground hover:text-foreground mt-2"
            onClick={handleTest}
            disabled={pending}
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {pending ? t("testing") : t("test")}
          </Button>
        )}
      </div>

      {connector?.connectable && connectOpen && (
        <ConnectModal
          providerKey={svc.key}
          title={t(`${svc.key}Label`)}
          color={svc.color}
          onClose={() => setConnectOpen(false)}
          t={t}
        />
      )}
    </div>
  )
}

function ConnectModal({
  providerKey,
  title,
  color,
  onClose,
  t,
}: {
  providerKey: IntegrationKey
  title: string
  color: string
  onClose: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const router = useRouter()
  const connector = CONNECTORS[providerKey]!
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    setError(null)
    startTransition(async () => {
      const r = await saveConnectionAction({ provider: providerKey, values })
      if (r.ok) { router.refresh(); onClose() } else setError(r.error ?? "Error")
    })
  }
  function disconnect() {
    setError(null)
    startTransition(async () => {
      const r = await clearConnectionAction(providerKey)
      if (r.ok) { router.refresh(); onClose() } else setError(r.error ?? "Error")
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-gray-900">
            <span
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: `${color}14`, color }}
            >
              <Plug className="w-4 h-4" />
            </span>
            {t("connectTitle", { name: title })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-gray-500">{t("connectHint")}</p>
          {connector.fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <label htmlFor={`c-${f.key}`} className="text-xs font-medium text-gray-600">{f.label}</label>
              <input
                id={`c-${f.key}`}
                type={f.masked ? "password" : "text"}
                autoComplete="off"
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                placeholder="••••••••"
                className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm text-gray-900 font-mono focus:outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400 pt-0.5">
            <Check className="w-3 h-3 text-emerald-600" />
            {t("encryptedNote")}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            <Button
              onClick={save}
              disabled={pending}
              className="flex-1 gap-1.5 cursor-pointer"
              style={{ background: "var(--brand)" }}
            >
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {t("save")}
            </Button>
            <Button
              variant="outline"
              onClick={disconnect}
              disabled={pending}
              className="text-xs text-red-600 border-red-200 hover:bg-red-50"
            >
              {t("disconnect")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
