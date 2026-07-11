"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Download, Trash2 } from "lucide-react"
import { pullSquareServices, type SquareServiceOption } from "../_actions/offer-brand-map-actions"
import {
  pullPbServices,
  createServiceMap,
  toggleServiceMapActive,
  deleteServiceMap,
  type PbServiceOption,
  type ServiceMapRow,
} from "../_actions/pb-service-map-actions"

type PbType = "face" | "phone" | "virtual"

type Props = {
  serviceMaps: ServiceMapRow[]
}

export function PbServiceMapTab({ serviceMaps }: Props) {
  const router = useRouter()
  const t = useTranslations("settings.pbServiceMap")
  const tc = useTranslations("common")
  const [, startTransition] = useTransition()

  // Pull Square services
  const [pullingSquare, setPullingSquare] = useState(false)
  const [squareServices, setSquareServices] = useState<SquareServiceOption[] | null>(null)

  // Pull PB services (destino del dropdown)
  const [pullingPb, setPullingPb] = useState(false)
  const [pbServices, setPbServices] = useState<PbServiceOption[] | null>(null)

  const [error, setError] = useState<string | null>(null)

  // Selección por servicio de Square
  const [pbChoice, setPbChoice] = useState<Record<string, string>>({})
  const [typeChoice, setTypeChoice] = useState<Record<string, PbType>>({})
  const [durChoice, setDurChoice] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)

  // Tabla de mapeos
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const mappedKeys = useMemo(() => {
    const s = new Set<string>()
    serviceMaps.forEach((m) => s.add(m.square_variation_id))
    return s
  }, [serviceMaps])

  const pbById = useMemo(() => {
    const m = new Map<string, PbServiceOption>()
    ;(pbServices ?? []).forEach((s) => m.set(s.id, s))
    return m
  }, [pbServices])

  async function handlePullSquare() {
    setPullingSquare(true)
    setError(null)
    try {
      const res = await pullSquareServices()
      if (!res.ok) {
        setError(res.error)
        setSquareServices([])
        return
      }
      setSquareServices(res.services)
    } finally {
      setPullingSquare(false)
    }
  }

  async function handlePullPb() {
    setPullingPb(true)
    setError(null)
    try {
      const res = await pullPbServices()
      if (!res.ok) {
        setError(res.error)
        setPbServices([])
        return
      }
      setPbServices(res.services)
    } finally {
      setPullingPb(false)
    }
  }

  function handlePickPb(variationId: string, pbServiceId: string) {
    setPbChoice((s) => ({ ...s, [variationId]: pbServiceId }))
    // Prellenar duración con la del servicio PB si viene y el campo está vacío.
    const pb = pbById.get(pbServiceId)
    if (pb?.duration != null) {
      setDurChoice((s) =>
        s[variationId] ? s : { ...s, [variationId]: String(pb.duration) },
      )
    }
  }

  async function handleSave(svc: SquareServiceOption) {
    const pbServiceId = pbChoice[svc.variationId]
    if (!pbServiceId) return
    const pb = pbById.get(pbServiceId)
    const durRaw = durChoice[svc.variationId]
    const durParsed = durRaw && durRaw.trim() ? Number.parseInt(durRaw, 10) : null
    setSavingKey(svc.variationId)
    setError(null)
    try {
      const res = await createServiceMap({
        square_variation_id: svc.variationId,
        square_label: svc.name,
        pb_service_id: pbServiceId,
        pb_service_name: pb?.name ?? null,
        pb_service_type: typeChoice[svc.variationId] ?? "virtual",
        duration_min: Number.isFinite(durParsed as number) ? durParsed : null,
        active: true,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      startTransition(() => router.refresh())
    } finally {
      setSavingKey(null)
    }
  }

  async function handleToggle(row: ServiceMapRow) {
    setTogglingId(row.id)
    try {
      const res = await toggleServiceMapActive(row.id, !row.active)
      if (!res.ok) setError(res.error)
      startTransition(() => router.refresh())
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete(row: ServiceMapRow) {
    setDeletingId(row.id)
    try {
      const res = await deleteServiceMap(row.id)
      if (!res.ok) setError(res.error)
      startTransition(() => router.refresh())
    } finally {
      setDeletingId(null)
    }
  }

  const pbReady = pbServices !== null && pbServices.length > 0

  return (
    <div className="space-y-5">
      {/* Ayuda */}
      <p className="text-sm text-muted-foreground">{t("help")}</p>

      {/* Botones jalar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="secondary"
          onClick={handlePullSquare}
          disabled={pullingSquare}
          className="gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          {pullingSquare ? t("pulling") : t("pullSquare")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handlePullPb}
          disabled={pullingPb}
          className="gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          {pullingPb ? t("pulling") : t("pullPb")}
        </Button>
        {pbServices !== null && (
          <span className="text-xs text-muted-foreground">
            {t("pbServicesTitle", { count: pbServices.length })}
          </span>
        )}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* Panel de servicios de Square jalados */}
      {squareServices !== null && (
        <div className="rounded-lg border border-border p-3 space-y-2 bg-secondary/20">
          <p className="text-xs font-semibold text-foreground">
            {t("squareServicesTitle", { count: squareServices.length })}
          </p>
          {squareServices.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("squareServicesEmpty")}</p>
          ) : !pbReady ? (
            <p className="text-xs text-muted-foreground">{t("pullPbFirst")}</p>
          ) : (
            <div className="space-y-1.5">
              {squareServices.map((svc) => {
                const already = mappedKeys.has(svc.variationId)
                return (
                  <div
                    key={svc.variationId}
                    className="flex items-center gap-2 py-1.5 border-b border-border last:border-0 flex-wrap"
                  >
                    <span className="flex-1 min-w-[160px]">
                      <span className="block text-sm text-foreground truncate">
                        {svc.name}
                      </span>
                      <span className="block text-[10px] text-muted-foreground font-mono truncate">
                        {svc.variationId}
                      </span>
                    </span>
                    {already ? (
                      <span className="text-xs text-emerald-600 shrink-0">
                        {t("alreadyMapped")}
                      </span>
                    ) : (
                      <>
                        {/* Servicio PB destino */}
                        <Select
                          value={pbChoice[svc.variationId] ?? ""}
                          onValueChange={(v) => handlePickPb(svc.variationId, v)}
                        >
                          <SelectTrigger className="h-8 w-44 bg-white border-border text-foreground text-xs shrink-0">
                            <SelectValue placeholder={t("pbPlaceholder")} />
                          </SelectTrigger>
                          <SelectContent>
                            {(pbServices ?? []).map((pb) => (
                              <SelectItem key={pb.id} value={pb.id}>
                                {pb.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {/* Tipo */}
                        <Select
                          value={typeChoice[svc.variationId] ?? "virtual"}
                          onValueChange={(v) =>
                            setTypeChoice((s) => ({ ...s, [svc.variationId]: v as PbType }))
                          }
                        >
                          <SelectTrigger className="h-8 w-28 bg-white border-border text-foreground text-xs shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="virtual">{t("typeVirtual")}</SelectItem>
                            <SelectItem value="phone">{t("typePhone")}</SelectItem>
                            <SelectItem value="face">{t("typeFace")}</SelectItem>
                          </SelectContent>
                        </Select>
                        {/* Duración opcional */}
                        <Input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={durChoice[svc.variationId] ?? ""}
                          onChange={(e) =>
                            setDurChoice((s) => ({ ...s, [svc.variationId]: e.target.value }))
                          }
                          placeholder={t("durationPlaceholder")}
                          className="h-8 w-32 bg-white text-xs shrink-0"
                        />
                        <Button
                          size="sm"
                          className="h-8 px-2 text-xs shrink-0"
                          disabled={
                            !pbChoice[svc.variationId] || savingKey === svc.variationId
                          }
                          onClick={() => handleSave(svc)}
                        >
                          {savingKey === svc.variationId ? tc("saving") : tc("save")}
                        </Button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Tabla de mapeos existentes */}
      {serviceMaps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                  {t("colMap")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                  {t("colType")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                  {t("colDuration")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                  {t("colStatus")}
                </th>
                <th className="px-3 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {serviceMaps.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
                >
                  <td className="px-3 py-2.5 text-foreground">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate max-w-[160px]">
                        {m.square_label || m.square_variation_id}
                      </span>
                      <span className="text-muted-foreground shrink-0">→</span>
                      <span className="truncate max-w-[160px]">
                        {m.pb_service_name || m.pb_service_id}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center text-[11px] bg-secondary text-muted-foreground border border-border rounded-full px-2 py-0.5 font-medium">
                      {t(`type${cap(m.pb_service_type)}` as
                        | "typeFace"
                        | "typePhone"
                        | "typeVirtual")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {m.duration_min != null ? (
                      t("durationMin", { count: m.duration_min })
                    ) : (
                      <span className="text-muted-foreground/50">{t("durationFromAppt")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => handleToggle(m)}
                      disabled={togglingId === m.id}
                      className="inline-flex items-center"
                      title={m.active ? t("clickToDeactivate") : t("clickToActivate")}
                    >
                      {m.active ? (
                        <span className="inline-flex items-center text-xs bg-emerald-400/10 text-emerald-600 border border-emerald-400/20 rounded-full px-2 py-0.5 font-medium hover:bg-emerald-400/20 transition-colors">
                          {tc("active")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-xs bg-zinc-400/10 text-zinc-400 border border-zinc-400/20 rounded-full px-2 py-0.5 font-medium hover:bg-zinc-400/20 transition-colors">
                          {tc("inactive")}
                        </span>
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => handleDelete(m)}
                      disabled={deletingId === m.id}
                      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                      title={tc("delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
