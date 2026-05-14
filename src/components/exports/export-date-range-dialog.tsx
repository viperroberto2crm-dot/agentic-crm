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

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (from: string, to: string) => void
  title?: string
  defaultRange?: PresetKey
}

const PRESETS: PresetKey[] = [
  "today",
  "thisWeek",
  "thisMonth",
  "lastMonth",
  "thisQuarter",
  "thisYear",
  "custom",
]

export function ExportDateRangeDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  defaultRange = "thisMonth",
}: Props) {
  const t = useTranslations("exports.dateRange")
  const tCommon = useTranslations("common")

  const [selectedPreset, setSelectedPreset] = useState<PresetKey>(defaultRange)
  const [fromInput, setFromInput] = useState<string>("")
  const [toInput, setToInput] = useState<string>("")

  // Initialize inputs whenever dialog opens or preset changes.
  const presetRange = useMemo(() => {
    if (selectedPreset === "custom") return null
    return getPresetRange(selectedPreset)
  }, [selectedPreset])

  useEffect(() => {
    if (!open) return
    if (selectedPreset === "custom") {
      // If user hasn't entered values yet, seed with current month range.
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
    // We intentionally exclude fromInput/toInput from deps to avoid loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedPreset, presetRange])

  const customRange =
    selectedPreset === "custom" ? rangeFromInputs(fromInput, toInput) : null
  const effectiveRange = selectedPreset === "custom" ? customRange : presetRange
  const canConfirm = effectiveRange !== null

  function handleConfirm() {
    if (!effectiveRange) return
    onConfirm(effectiveRange.from, effectiveRange.to)
    onOpenChange(false)
  }

  function handlePresetClick(p: PresetKey) {
    setSelectedPreset(p)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-gray-200 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gray-900">
            {title ?? t("title")}
          </DialogTitle>
          <DialogDescription className="text-gray-500">
            {t("selectRange")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => {
              const active = selectedPreset === p
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePresetClick(p)}
                  className={`px-3 py-1.5 rounded text-xs transition-colors border ${
                    active
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {t(`presets.${p}`)}
                </button>
              )
            })}
          </div>

          {selectedPreset === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="exp-from"
                  className="block text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5"
                >
                  {t("from")}
                </label>
                <Input
                  id="exp-from"
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
                  htmlFor="exp-to"
                  className="block text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5"
                >
                  {t("to")}
                </label>
                <Input
                  id="exp-to"
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
              {t("rangeSummary", {
                from: toDateInputValue(effectiveRange.from),
                to: toDateInputValue(effectiveRange.to),
              })}
            </p>
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
            {t("export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
