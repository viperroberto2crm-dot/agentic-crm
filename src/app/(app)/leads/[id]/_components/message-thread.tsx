"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { MessageSquare, Send, Loader2, FileText } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { sendSms, sendWhatsApp, getWhatsAppTemplates } from "../actions"

/**
 * Hilo de mensajes del paciente. Un solo hilo, dos canales: SMS (Twilio) y
 * WhatsApp (Meta Cloud API). Los dos viven en la misma tabla `messages`, por eso
 * la misma suscripción realtime sirve para ambos y solo se filtra por `channel`.
 *
 * Regla de Meta que la UI tiene que reflejar: fuera de la ventana de 24h desde
 * el último mensaje del paciente, WhatsApp NO acepta texto libre — solo
 * plantilla aprobada. Aquí eso se calcula para pintar el formulario correcto; la
 * validación que manda es la del servidor (sendWhatsApp).
 */

export type ThreadMessage = {
  id: string
  direction: "in" | "out"
  body: string | null
  status: string | null
  created_at: string
  /** null en las filas viejas, anteriores a WhatsApp → son SMS. */
  channel: string | null
}

type Channel = "sms" | "whatsapp"

type Template = {
  name: string
  language: string
  status: string
  category: string | null
  bodyText: string | null
  paramCount: number
}

type Props = {
  leadId: string
  brandId: string
  phone: string | null
  initial: ThreadMessage[]
  /** WhatsApp conectado en Configuración → Integraciones. */
  waEnabled: boolean
}

const WA_WINDOW_MS = 24 * 60 * 60 * 1000
const WA_GREEN = "#25D366"
const SMS_GREEN = "#2E8B6F"

export function MessageThread({ leadId, brandId, phone, initial, waEnabled }: Props) {
  const t = useTranslations("sms")
  const router = useRouter()
  const [channel, setChannel] = useState<Channel>("sms")
  const [live, setLive] = useState<ThreadMessage[]>([])
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Plantillas (solo se cargan cuando hacen falta).
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [tplLoading, setTplLoading] = useState(false)
  const [tplKey, setTplKey] = useState("")
  const [tplParams, setTplParams] = useState<string[]>([])

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

  // Ventana de 24h: desde el ÚLTIMO WhatsApp entrante. Se recalcula sola cuando
  // llega uno nuevo por realtime, así el formulario se reabre sin refrescar.
  const waWindowUntil = useMemo(() => {
    const lastIn = all
      .filter((m) => (m.channel ?? "sms") === "whatsapp" && m.direction === "in")
      .at(-1)
    if (!lastIn) return null
    return new Date(lastIn.created_at).getTime() + WA_WINDOW_MS
  }, [all])
  const waWindowOpen = waWindowUntil !== null && waWindowUntil > Date.now()

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

  function switchChannel(next: Channel) {
    setChannel(next)
    setError(null)
    setNotice(null)
  }

  const accent = channel === "whatsapp" ? WA_GREEN : SMS_GREEN

  function handleSend() {
    const body = text.trim()
    if (!body || pending) return
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const r =
        channel === "whatsapp"
          ? await sendWhatsApp({ lead_id: leadId, brand_id: brandId, body })
          : await sendSms({ lead_id: leadId, brand_id: brandId, body })
      if (r.ok) {
        setText("")
        setNotice(r.warning ?? null)
        router.refresh()
      } else {
        setError(r.error)
      }
    })
  }

  function loadTemplates() {
    if (tplLoading) return
    setTplLoading(true)
    setError(null)
    startTransition(async () => {
      const r = await getWhatsAppTemplates()
      setTplLoading(false)
      if (r.ok) setTemplates(r.templates)
      else setError(r.error)
    })
  }

  const selectedTpl = useMemo(
    () => templates?.find((x) => `${x.name}|${x.language}` === tplKey) ?? null,
    [templates, tplKey],
  )

  function handleSendTemplate() {
    if (!selectedTpl || pending) return
    const params = tplParams.slice(0, selectedTpl.paramCount).map((p) => p.trim())
    if (params.length < selectedTpl.paramCount || params.some((p) => !p)) {
      setError(t("waFillParams"))
      return
    }
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const r = await sendWhatsApp({
        lead_id: leadId,
        brand_id: brandId,
        template: {
          name: selectedTpl.name,
          language: selectedTpl.language,
          ...(params.length ? { params } : {}),
        },
      })
      if (r.ok) {
        setTplKey("")
        setTplParams([])
        setNotice(r.warning ?? null)
        router.refresh()
      } else {
        setError(r.error)
      }
    })
  }

  return (
    <div className="rounded-xl border border-[#E8E4DC] bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#EAE3D5]">
        <MessageSquare className="w-4 h-4 text-[#5C6F68]" />
        <h3 className="text-sm font-semibold text-[#3A4A44]">{t("title")}</h3>
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-[#F4F1EA] p-0.5">
          <ChannelTab
            active={channel === "sms"}
            onClick={() => switchChannel("sms")}
            label={t("tabSms")}
            color={SMS_GREEN}
          />
          <ChannelTab
            active={channel === "whatsapp"}
            onClick={() => switchChannel("whatsapp")}
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
          <>
            {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
            {notice && <p className="text-xs text-amber-700 mb-2">{notice}</p>}

            {channel === "whatsapp" && !waWindowOpen ? (
              // Fuera de la ventana de 24h: Meta solo acepta plantilla aprobada.
              <div className="space-y-2">
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
                  {t("waWindowClosed")}
                </p>
                {templates === null ? (
                  <button
                    type="button"
                    onClick={loadTemplates}
                    disabled={tplLoading}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors cursor-pointer"
                    style={{ backgroundColor: WA_GREEN }}
                  >
                    {tplLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    {t("waLoadTemplates")}
                  </button>
                ) : templates.length === 0 ? (
                  <p className="text-xs text-[#93A39D]">{t("waNoTemplates")}</p>
                ) : (
                  <>
                    <select
                      value={tplKey}
                      onChange={(e) => { setTplKey(e.target.value); setTplParams([]) }}
                      className="w-full rounded-lg border border-[#E8E4DC] px-3 py-2 text-sm text-[#3A4A44] bg-white focus:outline-none focus:ring-2 focus:ring-[#25D366]/20"
                    >
                      <option value="">{t("waPickTemplate")}</option>
                      {templates.map((x) => (
                        <option key={`${x.name}|${x.language}`} value={`${x.name}|${x.language}`}>
                          {x.name} · {x.language}
                        </option>
                      ))}
                    </select>

                    {selectedTpl && (
                      <>
                        {selectedTpl.bodyText && (
                          <p className="text-xs text-[#5C6F68] bg-[#F4F1EA] rounded-md p-2 whitespace-pre-wrap">
                            {selectedTpl.bodyText}
                          </p>
                        )}
                        {Array.from({ length: selectedTpl.paramCount }).map((_, i) => (
                          <input
                            key={i}
                            value={tplParams[i] ?? ""}
                            onChange={(e) => {
                              const next = [...tplParams]
                              next[i] = e.target.value
                              setTplParams(next)
                            }}
                            maxLength={500}
                            placeholder={t("waParam", { n: i + 1 })}
                            className="w-full rounded-lg border border-[#E8E4DC] px-3 py-2 text-sm text-[#3A4A44] focus:outline-none focus:ring-2 focus:ring-[#25D366]/20"
                          />
                        ))}
                        <button
                          type="button"
                          onClick={handleSendTemplate}
                          disabled={pending}
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors cursor-pointer"
                          style={{ backgroundColor: WA_GREEN }}
                        >
                          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          {t("waSendTemplate")}
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            ) : (
              <>
                {channel === "whatsapp" && waWindowUntil && (
                  <p className="text-[11px] text-[#5C6F68] mb-2">
                    {t("waWindowOpen", {
                      time: new Date(waWindowUntil).toLocaleString("es-US", {
                        timeZone: "America/Los_Angeles",
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      }),
                    })}
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() }
                    }}
                    rows={2}
                    maxLength={1000}
                    placeholder={t("placeholder")}
                    className="flex-1 resize-none rounded-lg border border-[#E8E4DC] px-3 py-2 text-sm text-[#3A4A44] focus:outline-none focus:ring-2 focus:ring-[#2E8B6F]/20"
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={pending || !text.trim()}
                    className="inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors cursor-pointer shrink-0"
                    style={{ backgroundColor: accent }}
                  >
                    {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {t("send")}
                  </button>
                </div>
              </>
            )}
          </>
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
