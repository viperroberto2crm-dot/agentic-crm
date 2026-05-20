"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getPresetRange,
  rangeFromInputs,
  toDateInputValue,
  type PresetKey,
} from "@/lib/exports/date-ranges"

const PRESETS: PresetKey[] = [
  "today",
  "thisWeek",
  "thisMonth",
  "lastMonth",
  "thisQuarter",
  "thisYear",
  "custom",
]

const BRAND_OPTIONS = [
  { value: "", labelKey: "brandAll" },
  { value: "sisepierde", labelKey: null, label: "Si Se Pierde" },
  { value: "sunnyslim", labelKey: null, label: "SunnySlim" },
] as const

export type ReportExportParams = {
  brand: string
  from: string | null
  to: string | null
  historico: boolean
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (params: ReportExportParams) => void
  defaultBrand?: string
}

export function ReportExportDialog({
  open,
  onOpenChange,
  onConfirm,
  defaultBrand = "",
}: Props) {
  const t = useTranslations("exports.report")
  const tRange = useTranslations("exports.dateRange")
  const tCommon = useTranslations("common")

  const [brand, setBrand] = useState<string>(defaultBrand)
  const [historico, setHistorico] = useState<boolean>(false)
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>("thisMonth")
  const [fromInput, setFromInput] = useState<string>("")
  const [toInput, setToInput] = useState<string>("")

  // Reset brand to defaultBrand cada vez que se abre
  useEffect(() => {
    if (open) setBrand(defaultBrand)
  }, [open, defaultBrand])

  const presetRange = useMemo(() => {
    if (selectedPreset === "custom") return null
    return getPresetRange(selectedPreset)
  }, [selectedPreset])

  useEffect(() => {
    if (!open || historico) return
    if (selectedPreset === "custom") {
      if (!fromInput || !toInput) {
        const seed = getPresetRange("thisMonth")
        setFromInput(toDateInputValue(seed.from))
        setToInput(toDateInputValue(seed.to))
      }
      return
    }
    if (presetRange) {
      setFromInput(toDateInputValue(presetRange.from))
      setToInput(toDateInputValue(presetRange.to))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedPreset, presetRange, historico])

  const customRange =
    selectedPreset === "custom" ? rangeFromInputs(fromInput, toInput) : null
  const effectiveRange = selectedPreset === "custom" ? customRange : presetRange

  const canConfirm = historico || effectiveRange !== null

  function handleConfirm() {
    if (historico) {
      onConfirm({ brand, from: null, to: null, historico: true })
    } else {
      if (!effectiveRange) return
      onConfirm({
        brand,
        from: effectiveRange.from,
        to: effectiveRange.to,
        historico: false,
      })
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-gray-200 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-gray-900">{t("title")}</DialogTitle>
          <DialogDescription className="text-gray-500">
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Marca */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5">
              {t("brand")}
            </label>
            <div className="flex flex-wrap gap-2">
              {BRAND_OPTIONS.map((opt) => {
                const active = brand === opt.value
                const label = opt.labelKey ? t(opt.labelKey) : opt.label
                return (
                  <button
                    key={opt.value || "all"}
                    type="button"
                    onClick={() => setBrand(opt.value)}
                    className={`px-3 py-1.5 rounded text-xs transition-colors border ${
                      active
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Histórico */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={historico}
              onChange={(e) => setHistorico(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
            />
            <span className="text-sm text-gray-700">{t("historico")}</span>
          </label>

          {/* Rango (solo si NO histórico) */}
          {!historico && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => {
                  const active = selectedPreset === p
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSelectedPreset(p)}
                      className={`px-3 py-1.5 rounded text-xs transition-colors border ${
                        active
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {tRange(`presets.${p}`)}
                    </button>
                  )
                })}
              </div>

              {selectedPreset === "custom" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="rep-from"
                      className="block text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5"
                    >
                      {tRange("from")}
                    </label>
                    <Input
                      id="rep-from"
                      type="date"
                      value={fromInput}
                      max={toInput || undefined}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setFromInput(e.target.value)
                      }
                      className="h-9 bg-white border-gray-200 text-gray-800 text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="rep-to"
                      className="block text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5"
                    >
                      {tRange("to")}
                    </label>
                    <Input
                      id="rep-to"
                      type="date"
                      value={toInput}
                      min={fromInput || undefined}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setToInput(e.target.value)
                      }
                      className="h-9 bg-white border-gray-200 text-gray-800 text-sm"
                    />
                  </div>
                </div>
              )}

              {selectedPreset !== "custom" && effectiveRange && (
                <p className="text-xs text-gray-500">
                  {tRange("rangeSummary", {
                    from: toDateInputValue(effectiveRange.from),
                    to: toDateInputValue(effectiveRange.to),
                  })}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-gray-200 text-gray-700 hover:bg-gray-100"
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{ background: "var(--brand)" }}
            className="text-white"
          >
            {t("generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
