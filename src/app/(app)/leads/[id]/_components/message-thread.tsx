"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { MessageSquare } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Composer, waWindowFrom, WA_GREEN, SMS_GREEN } from "@/components/messaging/composer"

/**
 * Hilo de mensajes del paciente. Un solo hilo, dos canales: SMS (Twilio) y
 * WhatsApp (Meta Cloud API). Los dos viven en la misma tabla `messages`, por eso
 * la misma suscripción realtime sirve para ambos y solo se filtra por `channel`.
 *
 * El formulario de abajo es el <Composer> compartido con la bandeja (/mensajes):
 * las reglas de WhatsApp (ventana de 24h, plantillas) viven en un solo lugar.
 */

export type ThreadMessage = {
  id: string
  direction: "in" | "out"
  body: string | null
  status: string | null
  created_at: string
  /** 'sms' | 'whatsapp'. NOT NULL en la base; el null es defensivo. */
  channel: string | null
}

type Channel = "sms" | "whatsapp"

type Props = {
  leadId: string
  brandId: string
  phone: string | null
  initial: ThreadMessage[]
  /** WhatsApp conectado en Configuración → Integraciones. */
  waEnabled: boolean
}

export function MessageThread({ leadId, brandId, phone, initial, waEnabled }: Props) {
  const t = useTranslations("sms")
  const router = useRouter()
  const [channel, setChannel] = useState<Channel>("sms")
  const [live, setLive] = useState<ThreadMessage[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const hasPhone = !!phone && phone.startsWith("+")

  // Unión (prop del server + realtime) sin duplicados, ordenada ascendente.
  const all = useMemo(() => {
    const map = new Map<string, ThreadMessage>()
    for (const m of [...initial, ...live]) map.set(m.id, m)
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
  }, [initial, live])

  const messages = useMemo(
    () => all.filter((m) => (m.channel ?? "sms") === channel),
    [all, channel],
  )

  // Se recalcula sola cuando llega un entrante por realtime, así el formulario
  // se reabre sin refrescar la página.
  const waWindow = useMemo(() => waWindowFrom(all), [all])

  // Suscripción realtime a INSERT en messages de ESTE lead (patrón del toast de
  // llamadas: adjuntar el JWT antes de subscribe + re-auth en TOKEN_REFRESHED).
  useEffect(() => {
    const sb = createClient()
    let ch: ReturnType<typeof sb.channel> | null = null
    let cancelled = false

    async function setup() {
      const { data } = await sb.auth.getSession()
      if (cancelled) return
      const token = data.session?.access_token
      if (token) sb.realtime.setAuth(token)
      ch = sb
        .channel(`messages_${leadId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `lead_id=eq.${leadId}` },
          (payload) => {
            const row = payload.new as ThreadMessage
            setLive((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
          },
        )
        .subscribe()
    }
    setup()

    const { data: authSub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session?.access_token) {
        sb.realtime.setAuth(session.access_token)
      }
    })
    return () => {
      cancelled = true
      authSub.subscription.unsubscribe()
      if (ch) sb.removeChannel(ch)
    }
  }, [leadId])

  // Auto-scroll al último mensaje (también al cambiar de canal).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length, channel])

  const accent = channel === "whatsapp" ? WA_GREEN : SMS_GREEN

  return (
    <div className="rounded-xl border border-[#E8E4DC] bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#EAE3D5]">
        <MessageSquare className="w-4 h-4 text-[#5C6F68]" />
        <h3 className="text-sm font-semibold text-[#3A4A44]">{t("title")}</h3>
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-[#F4F1EA] p-0.5">
          <ChannelTab
            active={channel === "sms"}
            onClick={() => setChannel("sms")}
            label={t("tabSms")}
            color={SMS_GREEN}
          />
          <ChannelTab
            active={channel === "whatsapp"}
            onClick={() => setChannel("whatsapp")}
            label={t("tabWhatsapp")}
            color={WA_GREEN}
          />
        </div>
      </div>

      <div ref={scrollRef} className="max-h-80 overflow-y-auto px-4 py-3 space-y-2 bg-[#FBFAF7]">
        {messages.length === 0 ? (
          <p className="text-sm text-[#93A39D] py-6 text-center">{t("empty")}</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                  m.direction === "out"
                    ? "text-white rounded-br-sm"
                    : "bg-white border border-[#E8E4DC] text-[#3A4A44] rounded-bl-sm"
                }`}
                style={m.direction === "out" ? { backgroundColor: accent } : undefined}
              >
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`text-[10px] mt-0.5 ${m.direction === "out" ? "text-white/70" : "text-[#93A39D]"}`}>
                  {new Date(m.created_at).toLocaleString("es-US", {
                    timeZone: "America/Los_Angeles",
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-[#EAE3D5] p-3">
        {!hasPhone ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
            {t("noPhone")}
          </p>
        ) : channel === "whatsapp" && !waEnabled ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
            {t("waNotConnected")}
          </p>
        ) : (
          <Composer
            leadId={leadId}
            brandId={brandId}
            channel={channel}
            waWindowOpen={waWindow.open}
            waWindowUntil={waWindow.until}
            onSent={() => router.refresh()}
          />
        )}
      </div>
    </div>
  )
}

function ChannelTab({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean
  onClick: () => void
  label: string
  color: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
        active ? "text-white" : "text-[#5C6F68] hover:text-[#3A4A44]"
      }`}
      style={active ? { backgroundColor: color } : undefined}
    >
      {label}
    </button>
  )
}
