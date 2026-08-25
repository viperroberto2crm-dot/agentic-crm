"use client"

import { useMemo, useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { Send, Loader2, FileText } from "lucide-react"
import { sendSms, sendWhatsApp, getWhatsAppTemplates } from "@/app/(app)/leads/[id]/actions"

/**
 * Compositor de mensajes. Lo usan LA FICHA del paciente y LA BANDEJA, para que
 * las reglas vivan en un solo lugar:
 *
 *  - SMS: texto libre siempre.
 *  - WhatsApp dentro de la ventana de 24h: texto libre.
 *  - WhatsApp fuera de la ventana: Meta solo acepta plantilla aprobada, así que
 *    el formulario CAMBIA a selector de plantilla + sus {{1}}, {{2}}…
 *
 * Ojo: esto solo pinta el formulario correcto. La validación que manda es la
 * del servidor (`sendWhatsApp`) — aquí nadie decide permisos.
 */

export type ComposerChannel = "sms" | "whatsapp"

export const WA_GREEN = "#25D366"
export const SMS_GREEN = "#2E8B6F"

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
  channel: ComposerChannel
  /** Solo aplica a WhatsApp: ¿el paciente escribió en las últimas 24h? */
  waWindowOpen: boolean
  /** Marca de tiempo en que se cierra la ventana (para avisar). */
  waWindowUntil: number | null
  onSent?: () => void
}

export function Composer({ leadId, brandId, channel, waWindowOpen, waWindowUntil, onSent }: Props) {
  const t = useTranslations("sms")
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [tplLoading, setTplLoading] = useState(false)
  const [tplKey, setTplKey] = useState("")
  const [tplParams, setTplParams] = useState<string[]>([])

  const accent = channel === "whatsapp" ? WA_GREEN : SMS_GREEN
  const needsTemplate = channel === "whatsapp" && !waWindowOpen

  const selectedTpl = useMemo(
    () => templates?.find((x) => `${x.name}|${x.language}` === tplKey) ?? null,
    [templates, tplKey],
  )

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
        onSent?.()
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
        onSent?.()
      } else {
        setError(r.error)
      }
    })
  }

  return (
    <>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {notice && <p className="text-xs text-amber-700 mb-2">{notice}</p>}

      {needsTemplate ? (
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
  )
}

/** Ventana de 24h de Meta calculada desde el último entrante de WhatsApp. */
export const WA_WINDOW_MS = 24 * 60 * 60 * 1000

export function waWindowFrom(
  messages: { channel: string | null; direction: "in" | "out"; created_at: string }[],
): { until: number | null; open: boolean } {
  const lastIn = messages.filter((m) => (m.channel ?? "sms") === "whatsapp" && m.direction === "in").at(-1)
  if (!lastIn) return { until: null, open: false }
  const until = new Date(lastIn.created_at).getTime() + WA_WINDOW_MS
  return { until, open: until > Date.now() }
}
