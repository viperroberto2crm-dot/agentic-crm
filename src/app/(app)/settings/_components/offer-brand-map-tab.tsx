"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, Pencil, Download } from "lucide-react"
import { OfferBrandMapDialog } from "./offer-brand-map-dialog"
import {
  toggleOfferMapActive,
  pullSquareServices,
  createOfferMap,
  type SquareServiceOption,
} from "../_actions/offer-brand-map-actions"

export type OfferMapRow = {
  id: string
  provider: string
  offer_key: string
  offer_label: string | null
  brand_id: string
  active: boolean
  created_at: string | null
  updated_at: string | null
}

export type BrandOption = {
  id: string
  name: string
}

type Props = {
  offerMaps: OfferMapRow[]
  brands: BrandOption[]
  defaultBrandId: string | null
}

export function OfferBrandMapTab({ offerMaps, brands, defaultBrandId }: Props) {
  const router = useRouter()
  const t = useTranslations("settings.offerBrandMap")
  const tc = useTranslations("common")
  const [createOpen, setCreateOpen] = useState(false)
  const [editRow, setEditRow] = useState<OfferMapRow | null>(null)
  const [brandFilter, setBrandFilter] = useState<string>("all")
  const [providerFilter, setProviderFilter] = useState<string>("all")
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // Square pull
  const [pulling, setPulling] = useState(false)
  const [squareServices, setSquareServices] = useState<SquareServiceOption[] | null>(null)
  const [pullError, setPullError] = useState<string | null>(null)
  const [serviceBrand, setServiceBrand] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const brandMap = useMemo(() => {
    const m = new Map<string, string>()
    brands.forEach((b) => m.set(b.id, b.name))
    return m
  }, [brands])

  const mappedKeys = useMemo(() => {
    const s = new Set<string>()
    offerMaps.forEach((o) => s.add(`${o.provider}:${o.offer_key}`))
    return s
  }, [offerMaps])

  const filtered = useMemo(() => {
    return offerMaps.filter((o) => {
      if (brandFilter !== "all" && o.brand_id !== brandFilter) return false
      if (providerFilter !== "all" && o.provider !== providerFilter) return false
      return true
    })
  }, [offerMaps, brandFilter, providerFilter])

  async function handleToggle(row: OfferMapRow) {
    setTogglingId(row.id)
    try {
      const result = await toggleOfferMapActive(row.id, !row.active)
      if (!result.ok) console.error("[offerBrandMap] toggle failed:", result.error)
      startTransition(() => router.refresh())
    } finally {
      setTogglingId(null)
    }
  }

  async function handlePull() {
    setPulling(true)
    setPullError(null)
    try {
      const res = await pullSquareServices()
      if (!res.ok) {
        setPullError(res.error)
        setSquareServices([])
        return
      }
      setSquareServices(res.services)
    } finally {
      setPulling(false)
    }
  }

  async function handleAssignService(svc: SquareServiceOption) {
    const brandId = serviceBrand[svc.variationId]
    if (!brandId) return
    setSavingKey(svc.variationId)
    try {
      const res = await createOfferMap({
        provider: "square",
        offer_key: svc.variationId,
        offer_label: svc.name,
        brand_id: brandId,
        active: true,
      })
      if (!res.ok) {
        setPullError(res.error)
        return
      }
      startTransition(() => router.refresh())
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground">
            {t("count", { count: filtered.length })}
          </p>
          {brands.length > 1 && (
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger className="h-8 w-44 bg-white border-border text-foreground text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filterAllBrands")}</SelectItem>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="h-8 w-32 bg-white border-border text-foreground text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterAllProviders")}</SelectItem>
              <SelectItem value="square">Square</SelectItem>
              <SelectItem value="stripe">Stripe</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={handlePull}
            disabled={pulling}
            className="gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            {pulling ? t("pulling") : t("pullSquare")}
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="gap-1.5"
            disabled={brands.length === 0}
          >
            <Plus className="w-3.5 h-3.5" />
            {t("newOfferMap")}
          </Button>
        </div>
      </div>

      {pullError && <p className="text-xs text-red-500">{pullError}</p>}

      {/* Panel de servicios de Square jalados */}
      {squareServices !== null && (
        <div className="rounded-lg border border-border p-3 space-y-2 bg-secondary/20">
          <p className="text-xs font-semibold text-foreground">
            {t("squareServicesTitle", { count: squareServices.length })}
          </p>
          {squareServices.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("squareServicesEmpty")}</p>
          ) : (
            <div className="space-y-1.5">
              {squareServices.map((svc) => {
                const already = mappedKeys.has(`square:${svc.variationId}`)
                return (
                  <div
                    key={svc.variationId}
                    className="flex items-center gap-2 py-1.5 border-b border-border last:border-0"
                  >
                    <span className="flex-1 min-w-0">
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
                        <Select
                          value={serviceBrand[svc.variationId] ?? ""}
                          onValueChange={(v) =>
                            setServiceBrand((s) => ({ ...s, [svc.variationId]: v }))
                          }
                        >
                          <SelectTrigger className="h-8 w-40 bg-white border-border text-foreground text-xs shrink-0">
                            <SelectValue placeholder={t("brandPlaceholder")} />
                          </SelectTrigger>
                          <SelectContent>
                            {brands.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          className="h-8 px-2 text-xs shrink-0"
                          disabled={
                            !serviceBrand[svc.variationId] ||
                            savingKey === svc.variationId
                          }
                          onClick={() => handleAssignService(svc)}
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

      {/* Tabla de mapeos */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("none")}</p>
          {brands.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-primary"
              onClick={() => setCreateOpen(true)}
            >
              {t("createFirst")}
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                  {t("colProvider")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                  {t("colOffer")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                  {t("colBrand")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                  {t("colStatus")}
                </th>
                <th className="px-3 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
                >
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center text-[11px] bg-secondary text-muted-foreground border border-border rounded-full px-2 py-0.5 font-medium capitalize">
                      {o.provider}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-foreground">
                    <span className="block truncate max-w-[240px]">
                      {o.offer_label || o.offer_key}
                    </span>
                    {o.offer_label && (
                      <span className="block text-[10px] text-muted-foreground font-mono truncate max-w-[240px]">
                        {o.offer_key}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {brandMap.get(o.brand_id) ?? (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => handleToggle(o)}
                      disabled={togglingId === o.id}
                      className="inline-flex items-center"
                      title={o.active ? t("clickToDeactivate") : t("clickToActivate")}
                    >
                      {o.active ? (
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
                      onClick={() => setEditRow(o)}
                      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title={t("editOfferMap")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <OfferBrandMapDialog
        mode="create"
        brands={brands}
        defaultBrandId={defaultBrandId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      {editRow && (
        <OfferBrandMapDialog
          key={editRow.id}
          mode="edit"
          offerMap={editRow}
          brands={brands}
          open={!!editRow}
          onClose={() => setEditRow(null)}
        />
      )}
    </div>
  )
}
