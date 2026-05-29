"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Phone, X } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { Database } from "@/types/database"

type CallRow = Database["public"]["Tables"]["calls"]["Row"]

type IncomingCall = {
  callId: string
  callerPhone: string
  brandSlug: string | null
  brandName: string | null
  // Info enriquecida del lead (si matchea)
  leadId: string | null
  leadName: string | null
  leadStatus: string | null
  hasActivePlan: boolean
  planBalance: number | null
  lastApptDate: string | null
}

const AUTO_DISMISS_MS = 60_000 // 60s

// Beep corto via Web Audio (no necesita archivo de audio)
function playBell() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g)
    g.connect(ctx.destination)
    o.frequency.setValueAtTime(880, ctx.currentTime) // A5
    o.frequency.setValueAtTime(1108, ctx.currentTime + 0.15) // C#6
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)
    o.start()
    o.stop(ctx.currentTime + 0.45)
  } catch {
    // Silent fail si el browser bloqueó audio (requiere user gesture)
  }
}

function fmtCents(cents: number | null): string {
  if (cents == null) return "$0"
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

function formatPhone(e164: string): string {
  if (!e164) return ""
  const digits = e164.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return e164
}

async function enrichCall(call: CallRow): Promise<IncomingCall> {
  const sb = createClient()
  // Brand info
  let brandSlug: string | null = null
  let brandName: string | null = null
  if (call.brand_id) {
    const { data: brand } = await sb
      .from("brands")
      .select("slug, name")
      .eq("id", call.brand_id)
      .maybeSingle()
    brandSlug = brand?.slug ?? null
    brandName = brand?.name ?? null
  }

  // Lead + summary
  let leadId: string | null = null
  let leadName: string | null = null
  let leadStatus: string | null = null
  let hasActivePlan = false
  let planBalance: number | null = null
  let lastApptDate: string | null = null

  if (call.lead_id) {
    const { data: lead } = await sb
      .from("leads")
      .select("id, first_name, last_name, status")
      .eq("id", call.lead_id)
      .maybeSingle()
    if (lead) {
      leadId = lead.id
      leadName = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || null
      leadStatus = lead.status

      // Plan info — last active plan
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: plans } = await (sb as any)
        .from("payment_plans")
        .select("total_amount_cents, abonos(amount_cents)")
        .eq("lead_id", call.lead_id)
        .order("created_at", { ascending: false })
        .limit(1)
      if (plans && plans.length > 0) {
        const p = plans[0]
        const totalPaid = (p.abonos ?? []).reduce(
          (s: number, a: { amount_cents: number }) => s + a.amount_cents,
          0,
        )
        const balance = (p.total_amount_cents ?? 0) - totalPaid
        if (balance > 0) {
          hasActivePlan = true
          planBalance = balance
        }
      }

      // Last appointment
      const { data: appt } = await sb
        .from("appointments")
        .select("scheduled_at")
        .eq("lead_id", call.lead_id)
        .order("scheduled_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      lastApptDate = appt?.scheduled_at ?? null
    }
  }

  return {
    callId: call.id,
    callerPhone: "",
    brandSlug,
    brandName,
    leadId,
    leadName,
    leadStatus,
    hasActivePlan,
    planBalance,
    lastApptDate,
  }
}

export function IncomingCallToast() {
  const router = useRouter()
  const [calls, setCalls] = useState<IncomingCall[]>([])
  const [rtStatus, setRtStatus] = useState<"connecting" | "subscribed" | "error" | "closed">("connecting")
  const audioPrimedRef = useRef(false)

  // Prime audio context — Chrome requiere user gesture antes de reproducir audio
  useEffect(() => {
    const prime = () => {
      audioPrimedRef.current = true
      window.removeEventListener("click", prime)
      window.removeEventListener("keydown", prime)
    }
    window.addEventListener("click", prime, { once: true })
    window.addEventListener("keydown", prime, { once: true })
    return () => {
      window.removeEventListener("click", prime)
      window.removeEventListener("keydown", prime)
    }
  }, [])

  useEffect(() => {
    const sb = createClient()
    console.log("[IncomingCallToast] mounting — fetching session…")

    let channel: ReturnType<typeof sb.channel> | null = null
    let cancelled = false

    async function setup() {
      // CRÍTICO: Antes de suscribir, asegurar que el JWT del usuario está
      // adjunto al websocket de Realtime. Sin esto, Realtime trata al cliente
      // como 'anon' y RLS filtra TODOS los broadcasts de postgres_changes.
      // @supabase/ssr no siempre lo hace automáticamente a tiempo.
      const { data: sessionData } = await sb.auth.getSession()
      if (cancelled) return
      const token = sessionData.session?.access_token
      if (token) {
        sb.realtime.setAuth(token)
        console.log("[IncomingCallToast] realtime auth token set")
      } else {
        console.warn("[IncomingCallToast] NO session — broadcasts likely blocked by RLS")
      }

      console.log("[IncomingCallToast] subscribing to calls INSERT…")
      channel = sb
        .channel("incoming_calls")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "calls",
          },
          async (payload) => {
            console.log("[IncomingCallToast] INSERT event received:", payload.new)
            const row = payload.new as CallRow
            if (row.direction !== "inbound") {
              console.log("[IncomingCallToast] ignored: direction !== inbound", row.direction)
              return
            }
            if (row.outcome != null) {
              console.log("[IncomingCallToast] ignored: outcome already set", row.outcome)
              return
            }

            const enriched = await enrichCall(row)
            setCalls((prev) => {
              if (prev.some((c) => c.callId === enriched.callId)) return prev
              return [enriched, ...prev]
            })

            if (audioPrimedRef.current) playBell()

            setTimeout(() => {
              setCalls((prev) => prev.filter((c) => c.callId !== enriched.callId))
            }, AUTO_DISMISS_MS)
          },
        )
        .subscribe((status, err) => {
          console.log("[IncomingCallToast] subscription status:", status, err ?? "")
          if (status === "SUBSCRIBED") setRtStatus("subscribed")
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setRtStatus("error")
          else if (status === "CLOSED") setRtStatus("closed")
        })
    }

    setup()

    return () => {
      cancelled = true
      if (channel) sb.removeChannel(channel)
    }
  }, [])

  function dismiss(callId: string) {
    setCalls((prev) => prev.filter((c) => c.callId !== callId))
  }

  // Debug: indicador de status de Realtime en la esquina (esquina inferior izquierda)
  const statusIndicator = (
    <div
      className="fixed bottom-2 left-2 z-[99] text-[10px] font-mono px-2 py-0.5 rounded shadow-sm select-none"
      style={{
        background:
          rtStatus === "subscribed"
            ? "rgba(16, 185, 129, 0.15)"
            : rtStatus === "error"
              ? "rgba(220, 38, 38, 0.15)"
              : "rgba(156, 163, 175, 0.15)",
        color:
          rtStatus === "subscribed"
            ? "#065f46"
            : rtStatus === "error"
              ? "#991b1b"
              : "#374151",
      }}
      title="Estado de Supabase Realtime para llamadas entrantes"
    >
      ● realtime: {rtStatus}
    </div>
  )

  if (calls.length === 0) return statusIndicator

  return (
    <>
      {statusIndicator}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {calls.map((call) => (
        <div
          key={call.callId}
          className="bg-white border-2 border-emerald-400 rounded-lg shadow-2xl p-4 animate-in slide-in-from-right-5"
          style={{ minWidth: 340 }}
        >
          <div className="flex items-start gap-3">
            <div className="bg-emerald-100 rounded-full p-2 shrink-0 animate-pulse">
              <Phone className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-emerald-600 font-bold mb-0.5">
                📞 Llamada entrando
              </p>
              {call.leadName ? (
                <p className="text-base font-semibold text-gray-900 truncate">
                  {call.leadName}
                </p>
              ) : (
                <p className="text-base font-semibold text-gray-900 truncate">
                  {call.callerPhone ? formatPhone(call.callerPhone) : "Número nuevo"}
                </p>
              )}
              {call.brandName && (
                <p className="text-[11px] text-gray-500 mt-0.5">
                  via {call.brandName}
                </p>
              )}

              {/* Contexto del lead si existe */}
              {call.leadId && (
                <div className="mt-2 space-y-1 text-xs">
                  {call.leadStatus && (
                    <p className="text-gray-700">
                      Status:{" "}
                      <span className="font-medium">
                        {call.leadStatus.replace(/_/g, " ")}
                      </span>
                    </p>
                  )}
                  {call.hasActivePlan && (
                    <p className="text-amber-700 font-medium">
                      💰 Plan activo — balance {fmtCents(call.planBalance)}
                    </p>
                  )}
                  {call.lastApptDate && (
                    <p className="text-gray-600">
                      Última cita: {new Date(call.lastApptDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}

              {/* Acciones */}
              <div className="flex gap-2 mt-3">
                {call.leadId ? (
                  <Link
                    href={`/leads/${call.leadId}`}
                    onClick={() => dismiss(call.callId)}
                    className="text-xs font-medium px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
                  >
                    Open lead
                  </Link>
                ) : (
                  <button
                    onClick={() => {
                      router.push("/calls")
                      dismiss(call.callId)
                    }}
                    className="text-xs font-medium px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
                  >
                    Ver call
                  </button>
                )}
              </div>
            </div>
            <button
              onClick={() => dismiss(call.callId)}
              className="text-gray-400 hover:text-gray-700 shrink-0"
              title="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
      </div>
    </>
  )
}
