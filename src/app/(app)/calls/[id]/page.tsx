import { createClient } from "@/lib/supabase/server"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Phone, Download, Calendar } from "lucide-react"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { getTranslations, getLocale } from "next-intl/server"


type TypedClient = SupabaseClient<Database>
type CallOutcome = Database["public"]["Enums"]["call_outcome"]
type CallDirection = Database["public"]["Enums"]["call_direction"]

// Fields not yet in the generated Database types but live in DB
// (see src/lib/integrations/800com.ts which uses the same pattern).
type CallExtras = {
  caller_e164: string | null
  dialed_e164: string | null
  tracking_number_id: string | null
  transcription_status:
    | "pending"
    | "processing"
    | "done"
    | "failed"
    | "skipped"
    | null
}

type TrackingNumberRow = {
  id: string
  label: string | null
  campaign: string | null
  phone_e164: string | null
  provider: string | null
}

function fmtDuration(s: number | null) {
  if (!s) return "—"
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const t = await getTranslations("calls")
  const locale = await getLocale()

  const [profileRes, callRes] = await Promise.all([
    sb.from("users").select("role").eq("id", user.id).single(),
    sb
      .from("calls")
      .select(
        `id, direction, outcome, duration_seconds, called_at, notes,
         source, external_id, recording_url, transcript_text, ai_summary,
         caller_e164, dialed_e164, tracking_number_id, transcription_status,
         rep_id, lead_id, brand_id,
         lead:leads!calls_lead_id_fkey(id, first_name, last_name, phone, status, assigned_rep_id),
         rep:users!calls_rep_id_fkey(id, name),
         brand:brands!calls_brand_id_fkey(id, name, brand_color)`,
      )
      .eq("id", id)
      .maybeSingle(),
  ])

  type CallDetail = {
    id: string
    direction: CallDirection
    outcome: CallOutcome | null
    duration_seconds: number | null
    called_at: string
    notes: string | null
    source: string
    external_id: string | null
    recording_url: string | null
    transcript_text: string | null
    ai_summary: string | null
    rep_id: string
    lead_id: string | null
    brand_id: string
    lead: {
      id: string
      first_name: string
      last_name: string | null
      phone: string
      status: Database["public"]["Enums"]["lead_status"]
      assigned_rep_id: string | null
    } | null
    rep: { id: string; name: string } | null
    brand: { id: string; name: string; brand_color: string | null } | null
  } & CallExtras

  const call = (callRes.data ?? null) as unknown as CallDetail | null
  if (!call) notFound()

  const role = (profileRes.data?.role ?? "rep") as string

  // Permissions: reps only see calls they own OR calls of leads assigned to them
  if (role === "rep") {
    const isOwnCall = call.rep_id === user.id
    const ownsLead = call.lead?.assigned_rep_id === user.id
    if (!isOwnCall && !ownsLead) notFound()
  }

  // Tracking number (only if attached)
  let tracking: TrackingNumberRow | null = null
  if (call.tracking_number_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: trk } = await (sb as any)
      .from("tracking_numbers")
      .select("id, label, campaign, phone_e164, provider")
      .eq("id", call.tracking_number_id)
      .maybeSingle()
    tracking = (trk ?? null) as TrackingNumberRow | null
  }

  const OUTCOME_CONFIG: Record<CallOutcome, { label: string; cls: string }> = {
    connected:           { label: t("outcomes.connected"),          cls: "border-emerald-500/40 text-emerald-400" },
    appointment_set:     { label: t("outcomes.appointment_set"),    cls: "border-blue-500/40 text-blue-400" },
    callback_requested:  { label: t("outcomes.callback_requested"), cls: "border-violet-500/40 text-violet-400" },
    voicemail:           { label: t("outcomes.voicemail"),          cls: "border-amber-500/40 text-amber-400" },
    no_answer:           { label: t("outcomes.no_answer"),          cls: "border-zinc-600 text-gray-400" },
    not_interested:      { label: t("outcomes.not_interested"),     cls: "border-red-500/40 text-red-400" },
    wrong_number:        { label: t("outcomes.wrong_number"),       cls: "border-zinc-600 text-gray-400" },
  }

  const outcomeCfg = call.outcome ? OUTCOME_CONFIG[call.outcome] : null

  const dateLabel = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(call.called_at))

  const leadFullName = call.lead
    ? `${call.lead.first_name} ${call.lead.last_name ?? ""}`.trim()
    : t("detail.noLead")

  const transcriptionStatus = call.transcription_status

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Breadcrumb + back */}
      <div className="space-y-3">
        <Link
          href="/calls"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("detail.backToCalls")}
        </Link>

        <nav className="text-xs text-gray-400 flex items-center gap-1.5 flex-wrap">
          <Link href="/calls" className="hover:text-gray-700 transition-colors">
            {t("detail.breadcrumbCalls")}
          </Link>
          <span className="text-gray-300">/</span>
          {call.lead ? (
            <Link
              href={`/leads/${call.lead.id}`}
              className="hover:text-gray-700 transition-colors"
            >
              {leadFullName}
            </Link>
          ) : (
            <span>{leadFullName}</span>
          )}
          <span className="text-gray-300">/</span>
          <span className="text-gray-700">{t("detail.breadcrumbDetail")}</span>
        </nav>
      </div>

      {/* Section 1 — Summary */}
      <Card className="bg-white border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
            {t("detail.summaryTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Row label={t("detail.caller")}>
              {call.lead ? (
                <Link
                  href={`/leads/${call.lead.id}`}
                  className="text-gray-900 hover:underline font-medium"
                >
                  {leadFullName}
                </Link>
              ) : (
                <span className="text-gray-400">{t("detail.noLead")}</span>
              )}
            </Row>

            <Row label={t("detail.callerPhone")}>
              {call.caller_e164 ? (
                <a
                  href={`tel:${call.caller_e164}`}
                  className="font-mono text-gray-700 hover:text-gray-900"
                >
                  {call.caller_e164}
                </a>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </Row>

            <Row label={t("detail.dialed")}>
              {call.dialed_e164 ? (
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-gray-700">
                    {call.dialed_e164}
                  </span>
                  {tracking?.label && (
                    <span className="text-[10px] text-gray-500">
                      {t("detail.dialedVia", { label: tracking.label })}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </Row>

            <Row label={t("detail.direction")}>
              <span className="text-xs text-gray-700">
                {call.direction === "outbound"
                  ? t("outboundRow")
                  : t("inboundRow")}
              </span>
            </Row>

            <Row label={t("detail.outcome")}>
              {outcomeCfg ? (
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 font-normal ${outcomeCfg.cls}`}
                >
                  {outcomeCfg.label}
                </Badge>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </Row>

            <Row label={t("detail.duration")}>
              <span className="tabular-nums text-gray-700">
                {fmtDuration(call.duration_seconds)}
              </span>
            </Row>

            <Row label={t("detail.dateTime")}>
              <span className="text-gray-700 inline-flex items-center gap-1.5">
                <Calendar className="w-3 h-3 text-gray-400" />
                {dateLabel}
              </span>
            </Row>
          </div>
        </CardContent>
      </Card>

      {/* Section 2 — Audio Player (only if recording_url) */}
      {call.recording_url && (
        <Card className="bg-white border-border/60">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
              {t("detail.recordingTitle")}
            </CardTitle>
            <a
              href={call.recording_url}
              download
              className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              {t("detail.downloadRecording")}
            </a>
          </CardHeader>
          <CardContent>
            <audio
              controls
              preload="metadata"
              src={call.recording_url}
              className="w-full"
            >
              {t("detail.browserNoAudio")}
            </audio>
          </CardContent>
        </Card>
      )}

      {/* Section 3 — Transcript (only if recording_url exists) */}
      {call.recording_url && (
        <Card className="bg-white border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
              {t("detail.transcriptTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {transcriptionStatus === "done" && call.transcript_text ? (
              <div className="max-h-96 overflow-y-auto rounded-md border border-gray-100 bg-gray-50/50 p-3">
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {call.transcript_text}
                </p>
              </div>
            ) : transcriptionStatus === "pending" ? (
              <p className="text-xs text-gray-500">
                {t("detail.transcriptPending")}
              </p>
            ) : transcriptionStatus === "processing" ? (
              <p className="text-xs text-amber-600">
                {t("detail.transcriptProcessing")}
              </p>
            ) : transcriptionStatus === "failed" ? (
              <p className="text-xs text-red-500">
                {t("detail.transcriptFailed")}
              </p>
            ) : transcriptionStatus === "skipped" ? (
              <p className="text-xs text-gray-400">
                {t("detail.transcriptSkipped")}
              </p>
            ) : (
              <p className="text-xs text-gray-400">
                {t("detail.transcriptEmpty")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Section 4 — AI Summary (only if exists) */}
      {call.ai_summary && (
        <Card className="bg-white border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
              {t("detail.summaryAiTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {call.ai_summary}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Section 5 — Tracking / Attribution (only if tracking_number) */}
      {tracking && (
        <Card className="bg-white border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
              {t("detail.trackingTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {tracking.campaign && (
                <Row label={t("detail.campaign")}>
                  <span className="text-gray-700">{tracking.campaign}</span>
                </Row>
              )}
              {(tracking.provider || call.source) && (
                <Row label={t("detail.sourceLabel")}>
                  <span className="text-gray-700">
                    {tracking.provider ?? call.source}
                  </span>
                </Row>
              )}
              {tracking.phone_e164 && (
                <Row label={t("detail.number")}>
                  <span className="font-mono text-gray-700 inline-flex items-center gap-1.5">
                    <Phone className="w-3 h-3 text-gray-400" />
                    {tracking.phone_e164}
                  </span>
                </Row>
              )}
              {call.brand && (
                <Row label={t("detail.brand")}>
                  <span className="flex items-center gap-1.5 text-gray-700">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background: call.brand.brand_color ?? "#3B82F6",
                      }}
                    />
                    {call.brand.name}
                  </span>
                </Row>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {call.notes && (
        <Card className="bg-white border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
              {t("detail.notesTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {call.notes}
            </p>
          </CardContent>
        </Card>
      )}

      <Separator className="bg-border" />
    </div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
        {label}
      </p>
      <div className="text-sm">{children}</div>
    </div>
  )
}
