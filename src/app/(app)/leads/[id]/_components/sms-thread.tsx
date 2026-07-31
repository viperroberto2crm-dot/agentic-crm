"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { MessageSquare, Send, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { sendSms } from "../actions"

export type SmsMessage = {
  id: string
  direction: "in" | "out"
  body: string | null
  status: string | null
  created_at: string
}

type Props = {
  leadId: string
  brandId: string
  phone: string | null
  initial: SmsMessage[]
}

export function SmsThread({ leadId, brandId, phone, initial }: Props) {
  const t = useTranslations("sms")
  const router = useRouter()
  const [live, setLive] = useState<SmsMessage[]>([])
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)

  const hasPhone = !!phone && phone.startsWith("+")

  // Unión (prop del server + realtime) sin duplicados, ordenada ascendente.
  const messages = useMemo(() => {
    const map = new Map<string, SmsMessage>()
    for (const m of [...initial, ...live]) map.set(m.id, m)
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
  }, [initial, live])

  // Suscripción realtime a INSERT en messages de ESTE lead (patrón del toast de
  // llamadas: adjuntar el JWT antes de subscribe + re-auth en TOKEN_REFRESHED).
  useEffect(() => {
    const sb = createClient()
    let channel: ReturnType<typeof sb.channel> | null = null
    let cancelled = false

    async function setup() {
      const { data } = await sb.auth.getSession()
      if (cancelled) return
      const token = data.session?.access_token
      if (token) sb.realtime.setAuth(token)
      channel = sb
        .channel(`messages_${leadId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `lead_id=eq.${leadId}` },
          (payload) => {
            const row = payload.new as SmsMessage
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
      if (channel) sb.removeChannel(channel)
    }
  }, [leadId])

  // Auto-scroll al último mensaje.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length])

  function handleSend() {
    const body = text.trim()
    if (!body || pending) return
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const r = await sendSms({ lead_id: leadId, brand_id: brandId, body })
      if (r.ok) {
        setText("")
        setNotice(r.warning ?? null)
        router.refresh()
      } else {
        setError(r.error)
      }
    })
  }

  return (
    <div className="rounded-xl border border-[#E8E4DC] bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#EAE3D5]">
        <MessageSquare className="w-4 h-4 text-[#5C6F68]" />
        <h3 className="text-sm font-semibold text-[#3A4A44]">{t("title")}</h3>
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
                    ? "bg-[#2E8B6F] text-white rounded-br-sm"
                    : "bg-white border border-[#E8E4DC] text-[#3A4A44] rounded-bl-sm"
                }`}
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
        ) : (
          <>
            {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
            {notice && <p className="text-xs text-amber-700 mb-2">{notice}</p>}
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
                className="inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-lg text-sm font-medium text-white bg-[#2E8B6F] hover:bg-[#277a61] disabled:opacity-50 transition-colors cursor-pointer shrink-0"
              >
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {t("send")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
