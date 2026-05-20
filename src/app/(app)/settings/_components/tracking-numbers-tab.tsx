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
import { Plus, Pencil } from "lucide-react"
import { TrackingNumberDialog } from "./tracking-number-dialog"
import { toggleTrackingNumberActive } from "../_actions/tracking-numbers-actions"

// Tipos locales — la tabla tracking_numbers no esta en Database types todavia.
export type TrackingNumberRow = {
  id: string
  brand_id: string
  phone_e164: string
  label: string
  provider: string
  provider_metadata: Record<string, unknown> | null
  campaign: string | null
  active: boolean
  created_at: string | null
  updated_at: string | null
}

export type BrandOption = {
  id: string
  name: string
}

type Props = {
  trackingNumbers: TrackingNumberRow[]
  brands: BrandOption[]
  defaultBrandId: string | null
}

export function TrackingNumbersTab({
  trackingNumbers,
  brands,
  defaultBrandId,
}: Props) {
  const router = useRouter()
  const t = useTranslations("settings.trackingNumbers")
  const tc = useTranslations("common")
  const [createOpen, setCreateOpen] = useState(false)
  const [editRow, setEditRow] = useState<TrackingNumberRow | null>(null)
  const [brandFilter, setBrandFilter] = useState<string>("all")
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const brandMap = useMemo(() => {
    const m = new Map<string, string>()
    brands.forEach((b) => m.set(b.id, b.name))
    return m
  }, [brands])

  const filtered = useMemo(() => {
    if (brandFilter === "all") return trackingNumbers
    return trackingNumbers.filter((tn) => tn.brand_id === brandFilter)
  }, [trackingNumbers, brandFilter])

  async function handleToggle(row: TrackingNumberRow) {
    setTogglingId(row.id)
    try {
      const result = await toggleTrackingNumberActive(row.id, !row.active)
      if (!result.ok) {
        // No tenemos toast estructurado aca; al menos refrescamos para que se vea estado
        console.error("[trackingNumbers] toggle failed:", result.error)
      }
      startTransition(() => router.refresh())
    } finally {
      setTogglingId(null)
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
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="gap-1.5"
          disabled={brands.length === 0}
        >
          <Plus className="w-3.5 h-3.5" />
          {t("newTrackingNumber")}
        </Button>
      </div>

      {/* Tabla */}
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
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                  {t("colPhone")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                  {t("colLabel")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">
                  {t("colCampaign")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">
                  {t("colBrand")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">
                  {t("colProvider")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                  {t("colStatus")}
                </th>
                <th className="px-3 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((tn) => (
                <tr
                  key={tn.id}
                  className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
                >
                  <td className="px-3 py-2.5 text-foreground font-mono text-xs">
                    {tn.phone_e164}
                  </td>
                  <td className="px-3 py-2.5 text-foreground">{tn.label}</td>
                  <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                    {tn.campaign || (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">
                    {brandMap.get(tn.brand_id) ?? (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell font-mono text-xs">
                    {tn.provider}
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => handleToggle(tn)}
                      disabled={togglingId === tn.id}
                      className="inline-flex items-center"
                      title={tn.active ? t("clickToDeactivate") : t("clickToActivate")}
                    >
                      {tn.active ? (
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
                      onClick={() => setEditRow(tn)}
                      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title={t("editTrackingNumber")}
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

      <TrackingNumberDialog
        mode="create"
        brands={brands}
        defaultBrandId={defaultBrandId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      {editRow && (
        <TrackingNumberDialog
          key={editRow.id}
          mode="edit"
          trackingNumber={editRow}
          brands={brands}
          open={!!editRow}
          onClose={() => setEditRow(null)}
        />
      )}
    </div>
  )
}
