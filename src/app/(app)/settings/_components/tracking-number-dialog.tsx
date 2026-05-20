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
  createTrackingNumber,
  updateTrackingNumber,
  deactivateTrackingNumber,
} from "../_actions/tracking-numbers-actions"
import type { TrackingNumberRow, BrandOption } from "./tracking-numbers-tab"

type Mode = "create" | "edit"
type Provider = "800com" | "twilio"

type Props = {
  mode: Mode
  trackingNumber?: TrackingNumberRow
  brands: BrandOption[]
  defaultBrandId?: string | null
  open: boolean
  onClose: () => void
}

type FormState = {
  brand_id: string
  phone_e164: string
  label: string
  campaign: string
  provider: Provider
  // 800com — fields
  ssp_number_id: string
  ssp_company_id: string
  // twilio — raw json
  twilio_json: string
  active: boolean
}

const E164_RE = /^\+[1-9]\d{1,14}$/

function readSspMeta(meta: unknown): { number_id: string; company_id: string } {
  if (!meta || typeof meta !== "object") return { number_id: "", company_id: "" }
  const m = meta as Record<string, unknown>
  const nid = m.number_id
  const cid = m.company_id
  return {
    number_id: nid === undefined || nid === null ? "" : String(nid),
    company_id: cid === undefined || cid === null ? "" : String(cid),
  }
}

function defaultForm(
  tn: TrackingNumberRow | undefined,
  brands: BrandOption[],
  defaultBrandId: string | null | undefined,
): FormState {
  if (!tn) {
    const fallbackBrand = defaultBrandId ?? brands[0]?.id ?? ""
    return {
      brand_id: fallbackBrand,
      phone_e164: "+1",
      label: "",
      campaign: "",
      provider: "800com",
      ssp_number_id: "",
      ssp_company_id: "",
      twilio_json: "{}",
      active: true,
    }
  }
  const provider = (tn.provider as Provider) ?? "800com"
  const ssp = readSspMeta(tn.provider_metadata)
  return {
    brand_id: tn.brand_id,
    phone_e164: tn.phone_e164 ?? "+1",
    label: tn.label ?? "",
    campaign: tn.campaign ?? "",
    provider,
    ssp_number_id: ssp.number_id,
    ssp_company_id: ssp.company_id,
    twilio_json:
      provider === "twilio" && tn.provider_metadata
        ? JSON.stringify(tn.provider_metadata, null, 2)
        : "{}",
    active: tn.active,
  }
}

function buildProviderMetadata(
  form: FormState,
): { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string } {
  if (form.provider === "800com") {
    const meta: Record<string, unknown> = {}
    if (form.ssp_number_id.trim()) {
      const n = Number(form.ssp_number_id.trim())
      if (!Number.isFinite(n)) {
        return { ok: false, error: "number_id debe ser numerico" }
      }
      meta.number_id = n
    }
    if (form.ssp_company_id.trim()) {
      const n = Number(form.ssp_company_id.trim())
      if (!Number.isFinite(n)) {
        return { ok: false, error: "company_id debe ser numerico" }
      }
      meta.company_id = n
    }
    return { ok: true, value: Object.keys(meta).length ? meta : null }
  }
  // twilio: raw json
  const raw = form.twilio_json.trim()
  if (!raw || raw === "{}") return { ok: true, value: null }
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "JSON debe ser un objeto" }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, error: "JSON invalido" }
  }
}

export function TrackingNumberDialog({
  mode,
  trackingNumber,
  brands,
  defaultBrandId,
  open,
  onClose,
}: Props) {
  const router = useRouter()
  const t = useTranslations("settings.trackingNumbers")
  const tc = useTranslations("common")
  const [form, setForm] = useState<FormState>(() =>
    defaultForm(trackingNumber, brands, defaultBrandId),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(defaultForm(trackingNumber, brands, defaultBrandId))
      setError(null)
      setConfirmDeactivate(false)
    }
  }, [open, trackingNumber, brands, defaultBrandId])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const phoneValid = E164_RE.test(form.phone_e164.trim())
  const canSave =
    !!form.brand_id &&
    !!form.label.trim() &&
    !!form.provider &&
    phoneValid

  async function handleSave() {
    if (!canSave) return
    setLoading(true)
    setError(null)
    const meta = buildProviderMetadata(form)
    if (!meta.ok) {
      setError(meta.error)
      setLoading(false)
      return
    }
    try {
      const payload = {
        brand_id: form.brand_id,
        phone_e164: form.phone_e164.trim(),
        label: form.label.trim(),
        campaign: form.campaign.trim() || null,
        provider: form.provider,
        provider_metadata: meta.value,
        active: form.active,
      }
      const result =
        mode === "create"
          ? await createTrackingNumber(payload)
          : await updateTrackingNumber({ ...payload, id: trackingNumber!.id })

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
    if (!trackingNumber) return
    setLoading(true)
    setError(null)
    try {
      const result = await deactivateTrackingNumber(trackingNumber.id)
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
          <Field label={t("brand")} required>
            <Select
              value={form.brand_id}
              onValueChange={(v) => set("brand_id", v)}
            >
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

          <Field label={t("phone")} required>
            <Input
              className={inputCls}
              value={form.phone_e164}
              onChange={(e) => set("phone_e164", e.target.value)}
              placeholder="+18883073743"
              autoFocus
            />
            {!phoneValid && form.phone_e164.trim() !== "+1" && (
              <p className="text-xs text-red-500">{t("phoneInvalid")}</p>
            )}
          </Field>

          <Field label={t("label")} required>
            <Input
              className={inputCls}
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder={t("labelPlaceholder")}
            />
          </Field>

          <Field label={t("campaign")}>
            <Input
              className={inputCls}
              value={form.campaign}
              onChange={(e) => set("campaign", e.target.value)}
              placeholder={t("campaignPlaceholder")}
            />
          </Field>

          <Field label={t("provider")} required>
            <Select
              value={form.provider}
              onValueChange={(v) => set("provider", v as Provider)}
            >
              <SelectTrigger className={inputCls}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="800com">800.com</SelectItem>
                <SelectItem value="twilio">Twilio</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {/* Provider-specific metadata */}
          {form.provider === "800com" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("sspNumberId")}>
                <Input
                  className={inputCls}
                  value={form.ssp_number_id}
                  onChange={(e) => set("ssp_number_id", e.target.value)}
                  placeholder="416682"
                  inputMode="numeric"
                />
              </Field>
              <Field label={t("sspCompanyId")}>
                <Input
                  className={inputCls}
                  value={form.ssp_company_id}
                  onChange={(e) => set("ssp_company_id", e.target.value)}
                  placeholder="195485"
                  inputMode="numeric"
                />
              </Field>
            </div>
          ) : (
            <Field label={t("providerMetadata")}>
              <textarea
                className={`${inputCls} w-full rounded-md border px-3 py-2 text-xs font-mono resize-none`}
                rows={5}
                value={form.twilio_json}
                onChange={(e) => set("twilio_json", e.target.value)}
                placeholder='{"sid": "...", "account_sid": "..."}'
                spellCheck={false}
              />
              <p className="text-[10px] text-muted-foreground">
                {t("providerMetadataHint")}
              </p>
            </Field>
          )}

          {/* Toggles */}
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
                  title={
                    !form.active ? t("alreadyInactive") : t("deactivateBtn")
                  }
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t("deactivateBtn")}
                </Button>
              )
            ) : (
              <span />
            )}

            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={loading}
              >
                {tc("cancel")}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={loading || !canSave}
              >
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
