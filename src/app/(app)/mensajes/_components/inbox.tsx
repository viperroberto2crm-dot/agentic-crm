"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Search, Loader2, UserPlus, ArrowLeft, ExternalLink, AlertTriangle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Composer, waWindowFrom, WA_GREEN, SMS_GREEN } from "@/components/messaging/composer"
import type { ThreadSummary, ThreadMessage } from "@/lib/queries/messages"
import { loadThread, markThreadRead, createLeadFromMessage } from "../actions"

type Props = {
  threads: ThreadSummary[]
  /** Conversaciones sin marca atribuida. Solo llegan con contenido si es admin. */
  unbranded: ThreadSummary[]
  brands: { id: string; name: string }[]
  truncated: boolean
  waEnabled: boolean
  isAdmin: boolean
}

type ChannelFilter = "all" | "sms" | "whatsapp"

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("es-US", {
    timeZone: "America/Los_Angeles",
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  })
}

export function Inbox({ threads, unbranded, brands, truncated, waEnabled, isAdmin }: Props) {
  const t = useTranslations("inbox")
  const router = useRouter()

  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all")
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [search, setSearch] = useState("")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Formulario de "crear paciente" (conversaciones sin lead).
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [formBrand, setFormBrand] = useState("")

  const allThreads = useMemo(
    () => [...threads, ...unbranded].sort(
      (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime(),
    ),
    [threads, unbranded],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allThreads.filter((th) => {
      if (channelFilter !== "all" && th.channel !== channelFilter) return false
      if (onlyUnread && th.unread === 0) return false
      if (!q) return true
      return (
        (th.leadName ?? "").toLowerCase().includes(q) ||
        (th.counterpart ?? "").toLowerCase().includes(q) ||
        (th.lastBody ?? "").toLowerCase().includes(q)
      )
    })
  }, [allThreads, channelFilter, onlyUnread, search])

  const selected = useMemo(
    () => allThreads.find((th) => th.key === selectedKey) ?? null,
    [allThreads, selectedKey],
  )

  const totalUnread = useMemo(
    () => allThreads.reduce((n, th) => n + th.unread, 0),
    [allThreads],
  )

  // Al abrir una conversación: cargar sus mensajes y marcarla como leída.
  useEffect(() => {
    if (!selected) { setMessages([]); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    const ref = {
      channel: selected.channel,
      lead_id: selected.leadId,
      counterpart: selected.counterpart,
      brand_id: selected.brandId,
    }
    loadThread(ref).then((r) => {
      if (cancelled) return
      setLoading(false)
      if (r.ok) setMessages(r.messages)
      else setError(r.error)
    })
    if (selected.unread > 0) {
      markThreadRead(ref).then((r) => {
        if (!cancelled && r.ok && r.updated > 0) router.refresh()
      })
    }
    return () => { cancelled = true }
    // `selected.unread` cambia tras el refresh; no queremos re-disparar por eso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  // Prellenar la marca del formulario con la de la conversación.
  useEffect(() => {
    setFirstName("")
    setLastName("")
    setFormBrand(selected?.brandId ?? brands[0]?.id ?? "")
  }, [selectedKey, selected?.brandId, brands])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length])

  // Realtime: cualquier mensaje nuevo que la RLS deje ver refresca la lista.
  useEffect(() => {
    const sb = createClient()
    let ch: ReturnType<typeof sb.channel> | null = null
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function setup() {
      const { data } = await sb.auth.getSession()
      if (cancelled) return
      const token = data.session?.access_token
      if (token) sb.realtime.setAuth(token)
      ch = sb
        .channel("inbox_messages")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          () => {
            // Ráfagas (una conversación activa) → un solo refresh.
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => router.refresh(), 600)
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
      if (timer) clearTimeout(timer)
      authSub.subscription.unsubscribe()
      if (ch) sb.removeChannel(ch)
    }
  }, [router])

  function handleCreateLead() {
    if (!selected?.counterpart || pending) return
    const name = firstName.trim()
    if (!name) { setError(t("needName")); return }
    if (!formBrand) { setError(t("needBrand")); return }
    setError(null)
    startTransition(async () => {
      const r = await createLeadFromMessage({
        counterpart: selected.counterpart as string,
        brand_id: formBrand,
        first_name: name,
        last_name: lastName.trim() || null,
        channel: selected.channel,
      })
      if (r.ok) {
        // La conversación cambia de identidad (num:… → lead:…): la deseleccionamos
        // para no dejar abierta una llave que ya no existe.
        setSelectedKey(null)
        router.refresh()
      } else {
        setError(r.error)
      }
    })
  }

  const waWindow = useMemo(() => waWindowFrom(messages), [messages])

  return (
    <div className="rounded-xl border border-[#E8E4DC] bg-white overflow-hidden">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[#EAE3D5]">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#93A39D]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search")}
            className="w-full h-9 pl-8 pr-3 rounded-lg border border-[#E8E4DC] text-sm text-[#3A4A44] focus:outline-none focus:ring-2 focus:ring-[#2E8B6F]/20"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-[#F4F1EA] p-0.5">
          {(["all", "sms", "whatsapp"] as ChannelFilter[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannelFilter(c)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                channelFilter === c ? "text-white" : "text-[#5C6F68] hover:text-[#3A4A44]"
              }`}
              style={
                channelFilter === c
                  ? { backgroundColor: c === "whatsapp" ? WA_GREEN : SMS_GREEN }
                  : undefined
              }
            >
              {t(c === "all" ? "filterAll" : c === "sms" ? "filterSms" : "filterWhatsapp")}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOnlyUnread((v) => !v)}
          className={`h-9 px-3 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
            onlyUnread
              ? "bg-[#2E8B6F] text-white border-[#2E8B6F]"
              : "border-[#E8E4DC] text-[#5C6F68] hover:text-[#3A4A44]"
          }`}
        >
          {t("onlyUnread")}{totalUnread > 0 ? ` (${totalUnread})` : ""}
        </button>
      </div>

      {truncated && (
        <p className="flex items-start gap-2 px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {t("truncated")}
        </p>
      )}

      <div className="grid md:grid-cols-[320px_1fr] min-h-[28rem]">
        {/* Lista de conversaciones */}
        <div
          className={`border-b md:border-b-0 md:border-r border-[#EAE3D5] max-h-[32rem] overflow-y-auto ${
            selectedKey ? "hidden md:block" : "block"
          }`}
        >
          {visible.length === 0 ? (
            <p className="text-sm text-[#93A39D] py-10 text-center px-4">{t("empty")}</p>
          ) : (
            visible.map((th) => (
              <button
                key={th.key}
                type="button"
                onClick={() => setSelectedKey(th.key)}
                className={`w-full text-left px-4 py-3 border-b border-[#F0EBE1] transition-colors cursor-pointer ${
                  th.key === selectedKey ? "bg-[#F4F1EA]" : "hover:bg-[#FBFAF7]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: th.channel === "whatsapp" ? WA_GREEN : SMS_GREEN }}
                  />
                  <span className="text-sm font-medium text-[#3A4A44] truncate">
                    {th.leadName ?? th.counterpart ?? t("unknown")}
                  </span>
                  {th.unread > 0 && (
                    <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#2E8B6F] text-white text-[10px] font-semibold grid place-items-center tabular-nums">
                      {th.unread}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#5C6F68] truncate mt-0.5">
                  {th.lastDirection === "out" ? "↗ " : ""}
                  {th.lastBody ?? ""}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-[#93A39D]">{fmtTime(th.lastAt)}</span>
                  {th.brandName ? (
                    <span className="text-[10px] text-[#93A39D] truncate">· {th.brandName}</span>
                  ) : (
                    <span className="text-[10px] text-amber-700">· {t("noBrand")}</span>
                  )}
                  {!th.leadId && (
                    <span className="ml-auto text-[10px] font-medium text-amber-700 shrink-0">
                      {t("notALead")}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Conversación */}
        <div className={`flex flex-col ${selectedKey ? "block" : "hidden md:flex"}`}>
          {!selected ? (
            <p className="text-sm text-[#93A39D] m-auto py-10 px-4 text-center">{t("pickOne")}</p>
          ) : (
            <>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[#EAE3D5]">
                <button
                  type="button"
                  onClick={() => setSelectedKey(null)}
                  className="md:hidden text-[#5C6F68] cursor-pointer"
                  aria-label={t("back")}
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#3A4A44] truncate">
                    {selected.leadName ?? selected.counterpart ?? t("unknown")}
                  </p>
                  <p className="text-[11px] text-[#93A39D] truncate">
                    {selected.counterpart ?? ""}
                    {selected.brandName ? ` · ${selected.brandName}` : ` · ${t("noBrand")}`}
                    {` · ${selected.channel === "whatsapp" ? t("filterWhatsapp") : t("filterSms")}`}
                  </p>
                </div>
                {selected.leadId && (
                  <Link
                    href={`/leads/${selected.leadId}`}
                    className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[#2E8B6F] hover:underline shrink-0"
                  >
                    {t("openLead")} <ExternalLink className="w-3 h-3" />
                  </Link>
                )}
              </div>

              <div ref={scrollRef} className="flex-1 max-h-[26rem] overflow-y-auto px-4 py-3 space-y-2 bg-[#FBFAF7]">
                {loading ? (
                  <p className="text-sm text-[#93A39D] py-10 text-center">
                    <Loader2 className="w-4 h-4 animate-spin inline" />
                  </p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-[#93A39D] py-10 text-center">{t("emptyThread")}</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                          m.direction === "out"
                            ? "text-white rounded-br-sm"
                            : "bg-white border border-[#E8E4DC] text-[#3A4A44] rounded-bl-sm"
                        }`}
                        style={
                          m.direction === "out"
                            ? { backgroundColor: selected.channel === "whatsapp" ? WA_GREEN : SMS_GREEN }
                            : undefined
                        }
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className={`text-[10px] mt-0.5 ${m.direction === "out" ? "text-white/70" : "text-[#93A39D]"}`}>
                          {fmtTime(m.created_at)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-[#EAE3D5] p-3">
                {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

                {!selected.leadId ? (
                  // Sin lead: primero se crea el paciente. Así el envío sigue
                  // pasando por los guards de opt-out y ventana de 24h.
                  <div className="space-y-2">
                    <p className="text-xs text-[#5C6F68]">{t("createLeadHelp")}</p>
                    <div className="flex flex-wrap gap-2">
                      <input
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder={t("firstName")}
                        maxLength={80}
                        className="flex-1 min-w-[120px] h-9 rounded-lg border border-[#E8E4DC] px-3 text-sm text-[#3A4A44] focus:outline-none focus:ring-2 focus:ring-[#2E8B6F]/20"
                      />
                      <input
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder={t("lastName")}
                        maxLength={80}
                        className="flex-1 min-w-[120px] h-9 rounded-lg border border-[#E8E4DC] px-3 text-sm text-[#3A4A44] focus:outline-none focus:ring-2 focus:ring-[#2E8B6F]/20"
                      />
                      <select
                        value={formBrand}
                        onChange={(e) => setFormBrand(e.target.value)}
                        className="h-9 rounded-lg border border-[#E8E4DC] px-2 text-sm text-[#3A4A44] bg-white focus:outline-none focus:ring-2 focus:ring-[#2E8B6F]/20"
                      >
                        <option value="">{t("pickBrand")}</option>
                        {brands.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleCreateLead}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium text-white bg-[#2E8B6F] hover:bg-[#277a61] disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                        {t("createLead")}
                      </button>
                    </div>
                    {!isAdmin && !selected.brandId && (
                      <p className="text-xs text-amber-700">{t("adminOnlyNoBrand")}</p>
                    )}
                  </div>
                ) : selected.channel === "whatsapp" && !waEnabled ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                    {t("waNotConnected")}
                  </p>
                ) : !selected.brandId ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                    {t("noBrandCantReply")}
                  </p>
                ) : (
                  <Composer
                    leadId={selected.leadId}
                    brandId={selected.brandId}
                    channel={selected.channel}
                    waWindowOpen={waWindow.open}
                    waWindowUntil={waWindow.until}
                    onSent={() => router.refresh()}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
