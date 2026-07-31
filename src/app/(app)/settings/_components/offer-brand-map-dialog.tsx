"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Trash2 } from "lucide-react"

import { Field, inputCls } from "./form-primitives"
import {
  createOfferMap,
  updateOfferMap,
  deactivateOfferMap,
} from "../_actions/offer-brand-map-actions"
import type { OfferMapRow, BrandOption } from "./offer-brand-map-tab"

type Mode = "create" | "edit"
type Provider = "square" | "stripe"
type Cadence = "weekly" | "monthly" | "quarterly" | "annual" | "one_time"

const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: "weekly", label: "Semanal (7 días)" },
  { value: "monthly", label: "Mensual (30 días)" },
  { value: "quarterly", label: "Trimestral (90 días)" },
  { value: "annual", label: "Anual (365 días)" },
  { value: "one_time", label: "Pago único (sin cobertura)" },
]

type Props = {
  mode: Mode
  offerMap?: OfferMapRow
  brands: BrandOption[]
  defaultBrandId?: string | null
  presetProvider?: Provider
  presetOfferKey?: string
  presetOfferLabel?: string
  open: boolean
  onClose: () => void
}

type FormState = {
  provider: Provider
  offer_key: string
  offer_label: string
  brand_id: string
  cadence: "none" | Cadence
  active: boolean
}

function normCadence(v: string | null | undefined): "none" | Cadence {
  const c = (v ?? "").trim().toLowerCase()
  if (c === "weekly" || c === "monthly" || c === "quarterly" || c === "annual" || c === "one_time") {
    return c
  }
  return "none"
}

function defaultForm(
  om: OfferMapRow | undefined,
  brands: BrandOption[],
  defaultBrandId: string | null | undefined,
  presetProvider: Provider | undefined,
  presetOfferKey: string | undefined,
  presetOfferLabel: string | undefined,
): FormState {
  if (!om) {
    return {
      provider: presetProvider ?? "square",
      offer_key: presetOfferKey ?? "",
      offer_label: presetOfferLabel ?? "",
      brand_id: defaultBrandId ?? brands[0]?.id ?? "",
      cadence: "none",
      active: true,
    }
  }
  return {
    provider: (om.provider as Provider) ?? "square",
    offer_key: om.offer_key ?? "",
    offer_label: om.offer_label ?? "",
    brand_id: om.brand_id,
    cadence: normCadence(om.cadence),
    active: om.active,
  }
}

export function OfferBrandMapDialog({
  mode,
  offerMap,
  brands,
  defaultBrandId,
  presetProvider,
  presetOfferKey,
  presetOfferLabel,
  open,
  onClose,
}: Props) {
  const router = useRouter()
  const t = useTranslations("settings.offerBrandMap")
  const tc = useTranslations("common")
  const [form, setForm] = useState<FormState>(() =>
    defaultForm(offerMap, brands, defaultBrandId, presetProvider, presetOfferKey, presetOfferLabel),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(
        defaultForm(offerMap, brands, defaultBrandId, presetProvider, presetOfferKey, presetOfferLabel),
      )
      setError(null)
      setConfirmDeactivate(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, offerMap, defaultBrandId, presetProvider, presetOfferKey, presetOfferLabel])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const canSave = !!form.brand_id && !!form.offer_key.trim() && !!form.provider

  async function handleSave() {
    if (!canSave) return
    setLoading(true)
    setError(null)
    try {
      const payload = {
        provider: form.provider,
        offer_key: form.offer_key.trim(),
        offer_label: form.offer_label.trim() || null,
        brand_id: form.brand_id,
        cadence: form.cadence === "none" ? null : form.cadence,
        active: form.active,
      }
      const result =
        mode === "create"
          ? await createOfferMap(payload)
          : await updateOfferMap({ ...payload, id: offerMap!.id })

      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"))
    } finally {
      setLoading(false)
    }
  }

  async function handleDeactivate() {
    if (!offerMap) return
    setLoading(true)
    setError(null)
    try {
      const result = await deactivateOfferMap(offerMap.id)
      if (!result.ok) {
        setError(result.error)
        setConfirmDeactivate(false)
        return
      }
      router.refresh()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"))
    } finally {
      setLoading(false)
    }
  }

  const title = mode === "create" ? t("titleCreate") : t("titleEdit")

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="light-surface max-w-md bg-white border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <Field label={t("provider")} required>
            <Select
              value={form.provider}
              onValueChange={(v) => set("provider", v as Provider)}
            >
              <SelectTrigger className={inputCls}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="square">Square</SelectItem>
                <SelectItem value="stripe">Stripe</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("offerKey")} required>
            <Input
              className={inputCls}
              value={form.offer_key}
              onChange={(e) => set("offer_key", e.target.value)}
              placeholder={t("offerKeyPlaceholder")}
              spellCheck={false}
            />
          </Field>

          <Field label={t("offerLabel")}>
            <Input
              className={inputCls}
              value={form.offer_label}
              onChange={(e) => set("offer_label", e.target.value)}
              placeholder={t("offerLabelPlaceholder")}
            />
          </Field>

          <Field label={t("brand")} required>
            <Select value={form.brand_id} onValueChange={(v) => set("brand_id", v)}>
              <SelectTrigger className={inputCls}>
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
          </Field>

          <Field label="Plan (para cobertura de prepago)">
            <Select
              value={form.cadence}
              onValueChange={(v) => set("cadence", v as "none" | Cadence)}
            >
              <SelectTrigger className={inputCls}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin plan (no calcula cobertura)</SelectItem>
                {CADENCE_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set("active", e.target.checked)}
                className="accent-primary w-4 h-4"
              />
              <span className="text-sm text-foreground">{t("activeToggle")}</span>
            </label>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex items-center justify-between gap-2 pt-1">
            {mode === "edit" ? (
              confirmDeactivate ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-500">
                    {t("confirmDeactivateQuestion")}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-red-500 hover:bg-red-50 hover:text-red-600"
                    onClick={handleDeactivate}
                    disabled={loading}
                  >
                    {loading ? t("deactivating") : t("confirmDeactivateBtn")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => setConfirmDeactivate(false)}
                    disabled={loading}
                  >
                    {t("deactivateNo")}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground hover:text-red-500 hover:bg-red-50 gap-1.5"
                  onClick={() => setConfirmDeactivate(true)}
                  disabled={loading || !form.active}
                  title={!form.active ? t("alreadyInactive") : t("deactivateBtn")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t("deactivateBtn")}
                </Button>
              )
            ) : (
              <span />
            )}

            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
                {tc("cancel")}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={loading || !canSave}>
                {loading
                  ? tc("saving")
                  : mode === "create"
                    ? tc("create")
                    : tc("save")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
