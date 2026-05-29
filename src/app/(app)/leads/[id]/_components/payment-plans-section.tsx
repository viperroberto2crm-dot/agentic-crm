"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus, Pencil, Trash2, CheckCircle2, Loader2, Circle, AlertCircle, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  addAbono,
  deleteAbono,
  updateAbono,
  updatePaymentPlan,
  deletePaymentPlan,
  updateInstallmentOverride,
  deleteInstallment,
  extendPaymentPlan,
  type PaymentPlan,
} from "../actions"

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  })
}

function todayIso() {
  return new Date().toISOString().split("T")[0]
}

function fmtDate(iso: string) {
  const d = new Date(iso + "T12:00:00")
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })
}

// Add `days` to an ISO date (YYYY-MM-DD) and return ISO date.
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00")
  d.setDate(d.getDate() + days)
  return d.toISOString().split("T")[0]
}

// Compare two ISO dates (YYYY-MM-DD). Returns negative if a<b, 0 equal, positive a>b.
export function cmpDateIso(a: string, b: string): number {
  return a.localeCompare(b)
}

// ── Add Abono Dialog ──────────────────────────────────────────────────────────

function AddAbonoDialog({
  open,
  onClose,
  planId,
  leadId,
  brandId,
}: {
  open: boolean
  onClose: () => void
  planId: string
  leadId: string
  brandId: string
}) {
  const t = useTranslations("plans")
  const tc = useTranslations("common")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [amountDollars, setAmountDollars] = useState("")
  const [paidAt, setPaidAt] = useState(todayIso())
  const [method, setMethod] = useState("cash")
  const [notes, setNotes] = useState("")

  function handleClose() {
    setAmountDollars("")
    setPaidAt(todayIso())
    setMethod("cash")
    setNotes("")
    setError(null)
    onClose()
  }

  function handleSubmit() {
    const cents = Math.round(parseFloat(amountDollars || "0") * 100)
    if (cents <= 0) return
    setError(null)
    startTransition(async () => {
      try {
        await addAbono({
          plan_id: planId,
          lead_id: leadId,
          brand_id: brandId,
          amount_cents: cents,
          paid_at: paidAt,
          payment_method: method,
          notes: notes.trim() || null,
        })
        router.refresh()
        handleClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("savingError"))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{t("addAbono")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">{t("amount")} *</label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={amountDollars}
                onChange={(e) => setAmountDollars(e.target.value)}
                placeholder="0.00"
                className="bg-white border-gray-200 text-gray-800 h-9 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">{t("paymentDate")}</label>
              <Input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="bg-white border-gray-200 text-gray-800 h-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">{t("paymentMethod")}</label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="bg-white border-gray-200 text-gray-700 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200">
                <SelectItem value="cash" className="text-gray-800">{t("cash")}</SelectItem>
                <SelectItem value="card" className="text-gray-800">{t("card")}</SelectItem>
                <SelectItem value="transfer" className="text-gray-800">{t("transfer")}</SelectItem>
                <SelectItem value="check" className="text-gray-800">{t("check")}</SelectItem>
                <SelectItem value="other" className="text-gray-800">{t("other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">{t("abonoNotes")}</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("abonoNotesPlaceholder")}
              className="bg-white border-gray-200 text-gray-800 h-9"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              disabled={isPending || !amountDollars || parseFloat(amountDollars) <= 0}
              onClick={handleSubmit}
              className="cursor-pointer"
              style={{ background: "var(--brand)" }}
            >
              {isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  {t("savingAbono")}
                </>
              ) : (
                t("confirmAbono")
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-gray-400 hover:text-gray-700"
              onClick={handleClose}
              disabled={isPending}
            >
              {tc("cancel")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit Abono Dialog ─────────────────────────────────────────────────────────

function EditAbonoDialog({
  open,
  onClose,
  abonoId,
  leadId,
  initialAmountCents,
  initialPaidAt,
  initialMethod,
  initialNotes,
}: {
  open: boolean
  onClose: () => void
  abonoId: string
  leadId: string
  initialAmountCents: number
  initialPaidAt: string
  initialMethod: string
  initialNotes: string | null
}) {
  const t = useTranslations("plans")
  const tc = useTranslations("common")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [amountDollars, setAmountDollars] = useState((initialAmountCents / 100).toFixed(2))
  // paid_at del DB es timestamptz/date; tomamos solo el YYYY-MM-DD
  const [paidAt, setPaidAt] = useState(initialPaidAt.slice(0, 10))
  const [method, setMethod] = useState(initialMethod || "cash")
  const [notes, setNotes] = useState(initialNotes ?? "")

  function handleClose() {
    setError(null)
    onClose()
  }

  function handleSubmit() {
    const cents = Math.round(parseFloat(amountDollars || "0") * 100)
    if (cents <= 0) {
      setError(t("amount") + " > 0")
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await updateAbono({
          abono_id: abonoId,
          lead_id: leadId,
          amount_cents: cents,
          paid_at: paidAt,
          payment_method: method,
          notes: notes.trim() || null,
        })
        router.refresh()
        handleClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("savingError"))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{tc("edit")} · {t("addAbono")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">{t("amount")} *</label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={amountDollars}
                onChange={(e) => setAmountDollars(e.target.value)}
                placeholder="0.00"
                className="bg-white border-gray-200 text-gray-800 h-9 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">{t("paymentDate")}</label>
              <Input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="bg-white border-gray-200 text-gray-800 h-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">{t("paymentMethod")}</label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="bg-white border-gray-200 text-gray-700 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200">
                <SelectItem value="cash" className="text-gray-800">{t("cash")}</SelectItem>
                <SelectItem value="card" className="text-gray-800">{t("card")}</SelectItem>
                <SelectItem value="transfer" className="text-gray-800">{t("transfer")}</SelectItem>
                <SelectItem value="check" className="text-gray-800">{t("check")}</SelectItem>
                <SelectItem value="other" className="text-gray-800">{t("other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">{t("abonoNotes")}</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("abonoNotesPlaceholder")}
              className="bg-white border-gray-200 text-gray-800 h-9"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              disabled={isPending || !amountDollars || parseFloat(amountDollars) <= 0}
              onClick={handleSubmit}
              className="cursor-pointer"
              style={{ background: "var(--brand)" }}
            >
              {isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  {tc("saving")}
                </>
              ) : (
                tc("save")
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-gray-400 hover:text-gray-700"
              onClick={handleClose}
              disabled={isPending}
            >
              {tc("cancel")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit Plan Dialog ──────────────────────────────────────────────────────────

function EditPlanDialog({
  open,
  onClose,
  plan,
  leadId,
}: {
  open: boolean
  onClose: () => void
  plan: PaymentPlan
  leadId: string
}) {
  const t = useTranslations("plans")
  const tc = useTranslations("common")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [productName, setProductName] = useState(plan.product_name)
  const [totalDollars, setTotalDollars] = useState(
    plan.total_amount_cents > 0 ? (plan.total_amount_cents / 100).toFixed(2) : "",
  )
  const [notes, setNotes] = useState(plan.notes ?? "")

  const hasSched =
    plan.installment_count != null && plan.installment_count > 0 && plan.frequency_days != null
  const [scheduleOn, setScheduleOn] = useState(hasSched)
  const [installmentCount, setInstallmentCount] = useState<string>(
    plan.installment_count != null ? String(plan.installment_count) : "4",
  )
  const [installmentAmount, setInstallmentAmount] = useState<string>(
    plan.installment_amount_cents != null
      ? (plan.installment_amount_cents / 100).toFixed(2)
      : "",
  )
  const [installmentAmountTouched, setInstallmentAmountTouched] = useState(
    plan.installment_amount_cents != null,
  )
  const initialFreq = (() => {
    const f = plan.frequency_days
    if (f === 7) return "7"
    if (f === 14) return "14"
    if (f === 30) return "30"
    if (f != null) return "custom"
    return "7"
  })()
  const [frequency, setFrequency] = useState<string>(initialFreq)
  const [customFrequency, setCustomFrequency] = useState<string>(
    plan.frequency_days != null && ![7, 14, 30].includes(plan.frequency_days)
      ? String(plan.frequency_days)
      : "",
  )
  const [firstDueDate, setFirstDueDate] = useState<string>(
    plan.first_due_date ?? todayIso(),
  )

  const totalNum = parseFloat(totalDollars || "0")
  const countNum = parseInt(installmentCount || "0", 10)
  const autoCalcAmount = totalNum > 0 && countNum > 0 ? (totalNum / countNum).toFixed(2) : ""
  const displayedInstallmentAmount = installmentAmountTouched ? installmentAmount : autoCalcAmount
  const effectiveFrequencyDays =
    frequency === "custom" ? parseInt(customFrequency || "0", 10) : parseInt(frequency, 10)

  function handleClose() {
    setError(null)
    onClose()
  }

  function handleSubmit() {
    if (!productName.trim()) return
    const cents = Math.round(parseFloat(totalDollars || "0") * 100)
    setError(null)

    let sched: {
      installment_count: number | null
      installment_amount_cents: number | null
      frequency_days: number | null
      first_due_date: string | null
    } = {
      installment_count: null,
      installment_amount_cents: null,
      frequency_days: null,
      first_due_date: null,
    }
    if (scheduleOn) {
      const count = parseInt(installmentCount, 10)
      const amountDollars = parseFloat(displayedInstallmentAmount || "0")
      if (!count || count < 1) { setError(t("schedule.installmentCount")); return }
      if (!amountDollars || amountDollars <= 0) { setError(t("schedule.installmentAmount")); return }
      if (!effectiveFrequencyDays || effectiveFrequencyDays < 1) { setError(t("schedule.frequency")); return }
      if (!firstDueDate) { setError(t("schedule.firstDueDate")); return }
      sched = {
        installment_count: count,
        installment_amount_cents: Math.round(amountDollars * 100),
        frequency_days: effectiveFrequencyDays,
        first_due_date: firstDueDate,
      }
    }

    startTransition(async () => {
      try {
        await updatePaymentPlan({
          id: plan.id,
          lead_id: leadId,
          product_name: productName.trim(),
          total_amount_cents: cents,
          notes: notes.trim() || null,
          ...sched,
        })
        router.refresh()
        handleClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("savingError"))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{tc("edit")} · {plan.product_name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">{t("productName")} *</label>
            <Input value={productName} onChange={(e) => setProductName(e.target.value)}
              className="bg-white border-gray-200 text-gray-800 h-9" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">{t("totalAmount")}</label>
            <Input type="number" min="0" step="0.01" value={totalDollars}
              onChange={(e) => setTotalDollars(e.target.value)}
              className="bg-white border-gray-200 text-gray-800 h-9 font-mono" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">{t("planNotes")}</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 resize-none" />
          </div>

          <div className="rounded-md border border-gray-200 bg-gray-50/60">
            <label className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
              <input type="checkbox" checked={scheduleOn}
                onChange={(e) => setScheduleOn(e.target.checked)}
                className="h-3.5 w-3.5 accent-zinc-700" />
              <span className="text-xs font-medium text-gray-700">{t("schedule.enable")}</span>
            </label>

            {scheduleOn && (
              <div className="px-3 pb-3 pt-1 space-y-3 border-t border-gray-200">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-gray-500">{t("schedule.installmentCount")} *</label>
                    <Input type="number" min="1" max="100" step="1" value={installmentCount}
                      onChange={(e) => setInstallmentCount(e.target.value)}
                      className="bg-white border-gray-200 text-gray-800 h-9 font-mono" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-gray-500">{t("schedule.installmentAmount")} *</label>
                    <Input type="number" min="0" step="0.01" value={displayedInstallmentAmount}
                      onChange={(e) => { setInstallmentAmountTouched(true); setInstallmentAmount(e.target.value) }}
                      className="bg-white border-gray-200 text-gray-800 h-9 font-mono" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-gray-500">{t("schedule.frequency")} *</label>
                    <Select value={frequency} onValueChange={setFrequency}>
                      <SelectTrigger className="bg-white border-gray-200 text-gray-700 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200">
                        <SelectItem value="7" className="text-gray-800">{t("schedule.frequencyWeekly")}</SelectItem>
                        <SelectItem value="14" className="text-gray-800">{t("schedule.frequencyBiweekly")}</SelectItem>
                        <SelectItem value="30" className="text-gray-800">{t("schedule.frequencyMonthly")}</SelectItem>
                        <SelectItem value="custom" className="text-gray-800">{tc("optional")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {frequency === "custom" && (
                      <Input type="number" min="1" max="365" step="1" value={customFrequency}
                        onChange={(e) => setCustomFrequency(e.target.value)} placeholder="days"
                        className="bg-white border-gray-200 text-gray-800 h-9 font-mono mt-1" />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-gray-500">{t("schedule.firstDueDate")} *</label>
                    <Input type="date" value={firstDueDate}
                      onChange={(e) => setFirstDueDate(e.target.value)}
                      className="bg-white border-gray-200 text-gray-800 h-9" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button type="button" disabled={isPending || !productName.trim()}
              onClick={handleSubmit} className="cursor-pointer" style={{ background: "var(--brand)" }}>
              {isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />{tc("saving")}</> : tc("save")}
            </Button>
            <Button type="button" variant="ghost"
              className="text-gray-400 hover:text-gray-700"
              onClick={handleClose} disabled={isPending}>
              {tc("cancel")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit Installment Dialog ───────────────────────────────────────────────────

function EditInstallmentDialog({
  open,
  onClose,
  planId,
  leadId,
  sequence,
  currentDueDate,
  currentAmountCents,
  defaultDueDate,
  defaultAmountCents,
}: {
  open: boolean
  onClose: () => void
  planId: string
  leadId: string
  sequence: number
  currentDueDate: string
  currentAmountCents: number
  defaultDueDate: string
  defaultAmountCents: number
}) {
  const tc = useTranslations("common")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState(currentDueDate)
  const [amount, setAmount] = useState((currentAmountCents / 100).toFixed(2))
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleClose() {
    setDueDate(currentDueDate)
    setAmount((currentAmountCents / 100).toFixed(2))
    setError(null)
    setConfirmDelete(false)
    onClose()
  }

  function handleDelete() {
    setError(null)
    startTransition(async () => {
      try {
        await deleteInstallment({
          plan_id: planId,
          lead_id: leadId,
          sequence,
        })
        router.refresh()
        handleClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error eliminando")
        setConfirmDelete(false)
      }
    })
  }

  function handleSubmit() {
    setError(null)
    const amtNum = parseFloat(amount || "0")
    if (!Number.isFinite(amtNum) || amtNum < 0) {
      setError("Monto inválido")
      return
    }
    const amtCents = Math.round(amtNum * 100)

    // Si el valor matchea el default, mandamos null para REMOVER el override
    const dueDateOverride = dueDate === defaultDueDate ? null : dueDate
    const amountOverride = amtCents === defaultAmountCents ? null : amtCents

    startTransition(async () => {
      try {
        await updateInstallmentOverride({
          plan_id: planId,
          lead_id: leadId,
          sequence,
          due_date: dueDateOverride,
          amount_cents: amountOverride,
        })
        router.refresh()
        handleClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error guardando")
      }
    })
  }

  function handleReset() {
    setDueDate(defaultDueDate)
    setAmount((defaultAmountCents / 100).toFixed(2))
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Cuota #{sequence}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">Fecha</label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="bg-white border-gray-200 text-gray-800 h-9"
            />
            {defaultDueDate !== dueDate && (
              <p className="text-[10px] text-gray-400">
                Default: {defaultDueDate}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">Monto (USD)</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-white border-gray-200 text-gray-800 h-9 font-mono"
            />
            {Math.round(parseFloat(amount || "0") * 100) !== defaultAmountCents && (
              <p className="text-[10px] text-gray-400">
                Default: ${(defaultAmountCents / 100).toFixed(2)}
              </p>
            )}
          </div>

          <p className="text-[11px] text-gray-400 leading-snug">
            Solo esta cuota se modifica. Las demás no se mueven.
          </p>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-gray-500"
                onClick={handleReset}
                disabled={isPending}
              >
                Restaurar default
              </Button>
              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isPending}
                    className="px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 rounded"
                  >
                    {isPending ? "…" : "Confirmar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={isPending}
                    className="px-2 py-1 text-[11px] text-gray-400 hover:bg-gray-100 rounded"
                  >
                    {tc("cancel")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={isPending}
                  className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded inline-flex items-center gap-1"
                  title="Eliminar esta cuota del plan"
                >
                  <Trash2 className="w-3 h-3" />
                  Eliminar
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                disabled={isPending}
              >
                {tc("cancel")}
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={isPending}
                style={{ background: "var(--brand)" }}
              >
                {isPending ? tc("saving") : tc("save")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Extend Plan (Batch) Dialog ────────────────────────────────────────────────

function ExtendPlanDialog({
  open,
  onClose,
  plan,
  leadId,
  lastExistingDueDate,
}: {
  open: boolean
  onClose: () => void
  plan: PaymentPlan
  leadId: string
  lastExistingDueDate: string | null
}) {
  const tc = useTranslations("common")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const defaultFreq = plan.frequency_days ?? 7
  const defaultAmount = (
    (plan.installment_amount_cents ?? 0) / 100
  ).toFixed(2)
  const defaultStart =
    lastExistingDueDate
      ? addDaysIso(lastExistingDueDate, defaultFreq)
      : todayIso()

  const [count, setCount] = useState("4")
  const [frequency, setFrequency] = useState(String(defaultFreq))
  const [customFreq, setCustomFreq] = useState("")
  const [amount, setAmount] = useState(defaultAmount || "")
  const [startDate, setStartDate] = useState(defaultStart)

  function handleClose() {
    setCount("4")
    setFrequency(String(defaultFreq))
    setCustomFreq("")
    setAmount(defaultAmount || "")
    setStartDate(defaultStart)
    setError(null)
    onClose()
  }

  function handleSubmit() {
    setError(null)
    const n = parseInt(count, 10)
    const freq =
      frequency === "custom" ? parseInt(customFreq, 10) || 0 : parseInt(frequency, 10)
    const amtCents = Math.round(parseFloat(amount || "0") * 100)
    if (!n || n < 1 || n > 52) { setError("Cantidad inválida (1-52)"); return }
    if (!freq || freq < 1) { setError("Frecuencia inválida"); return }
    if (!amtCents || amtCents < 1) { setError("Monto inválido"); return }
    if (!startDate) { setError("Fecha inicio requerida"); return }

    const items = Array.from({ length: n }, (_, i) => ({
      due_date: addDaysIso(startDate, i * freq),
      amount_cents: amtCents,
    }))

    startTransition(async () => {
      try {
        await extendPaymentPlan({
          plan_id: plan.id,
          lead_id: leadId,
          installments: items,
        })
        router.refresh()
        handleClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("savingError"))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Agregar pagos</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <p className="text-xs text-gray-500 leading-snug">
            Continúa el plan con cuotas adicionales. Se agregan al final.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Cuántos pagos *</label>
              <Input
                type="number" min="1" max="52" step="1"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="bg-white border-gray-200 text-gray-800 h-9 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Monto por cuota *</label>
              <Input
                type="number" min="0.01" step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="bg-white border-gray-200 text-gray-800 h-9 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Frecuencia *</label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger className="bg-white border-gray-200 text-gray-700 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-gray-200">
                  <SelectItem value="7" className="text-gray-800">Semanal</SelectItem>
                  <SelectItem value="14" className="text-gray-800">Quincenal</SelectItem>
                  <SelectItem value="30" className="text-gray-800">Mensual</SelectItem>
                  <SelectItem value="custom" className="text-gray-800">Personalizada</SelectItem>
                </SelectContent>
              </Select>
              {frequency === "custom" && (
                <Input
                  type="number" min="1" max="365" step="1"
                  value={customFreq}
                  onChange={(e) => setCustomFreq(e.target.value)}
                  placeholder="días"
                  className="bg-white border-gray-200 text-gray-800 h-9 font-mono mt-1"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Primera fecha *</label>
              <Input
                type="date" value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-white border-gray-200 text-gray-800 h-9"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              disabled={isPending}
              onClick={handleSubmit}
              className="cursor-pointer"
              style={{ background: "var(--brand)" }}
            >
              {isPending ? (<><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />{tc("saving")}</>) : "Agregar pagos"}
            </Button>
            <Button type="button" variant="ghost"
              className="text-gray-400 hover:text-gray-700"
              onClick={handleClose} disabled={isPending}>
              {tc("cancel")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Add Single Installment Dialog ─────────────────────────────────────────────

function AddInstallmentDialog({
  open,
  onClose,
  plan,
  leadId,
}: {
  open: boolean
  onClose: () => void
  plan: PaymentPlan
  leadId: string
}) {
  const tc = useTranslations("common")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState(todayIso())
  const [amount, setAmount] = useState(
    plan.installment_amount_cents
      ? (plan.installment_amount_cents / 100).toFixed(2)
      : "",
  )

  function handleClose() {
    setDueDate(todayIso())
    setAmount(plan.installment_amount_cents ? (plan.installment_amount_cents / 100).toFixed(2) : "")
    setError(null)
    onClose()
  }

  function handleSubmit() {
    setError(null)
    const cents = Math.round(parseFloat(amount || "0") * 100)
    if (!dueDate) { setError("Fecha requerida"); return }
    if (!cents || cents < 1) { setError("Monto inválido"); return }
    startTransition(async () => {
      try {
        await extendPaymentPlan({
          plan_id: plan.id,
          lead_id: leadId,
          installments: [{ due_date: dueDate, amount_cents: cents }],
        })
        router.refresh()
        handleClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("savingError"))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Agregar pago manual</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <p className="text-xs text-gray-500 leading-snug">
            Agrega una cuota con fecha y monto específicos al final del plan.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Fecha *</label>
              <Input
                type="date" value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="bg-white border-gray-200 text-gray-800 h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Monto *</label>
              <Input
                type="number" min="0.01" step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="bg-white border-gray-200 text-gray-800 h-9 font-mono"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              disabled={isPending}
              onClick={handleSubmit}
              className="cursor-pointer"
              style={{ background: "var(--brand)" }}
            >
              {isPending ? (<><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />{tc("saving")}</>) : "Agregar"}
            </Button>
            <Button type="button" variant="ghost"
              className="text-gray-400 hover:text-gray-700"
              onClick={handleClose} disabled={isPending}>
              {tc("cancel")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Plan Card ─────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  leadId,
  brandId,
}: {
  plan: PaymentPlan
  leadId: string
  brandId: string
}) {
  const t = useTranslations("plans")
  const tc = useTranslations("common")
  const router = useRouter()
  const [abonoOpen, setAbonoOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [extendOpen, setExtendOpen] = useState(false)
  const [addOneOpen, setAddOneOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingInstallment, setEditingInstallment] = useState<number | null>(null)
  const [editingAbonoId, setEditingAbonoId] = useState<string | null>(null)

  async function handleDeletePlan() {
    setIsDeleting(true)
    try {
      await deletePaymentPlan(plan.id, leadId)
      router.refresh()
    } catch {
      // silent
    } finally {
      setIsDeleting(false)
      setConfirmDelete(false)
    }
  }

  const paidCents = plan.abonos.reduce((s, a) => s + a.amount_cents, 0)
  const balanceCents = Math.max(0, plan.total_amount_cents - paidCents)
  const isSettled = plan.total_amount_cents > 0 && balanceCents === 0
  const progress =
    plan.total_amount_cents > 0
      ? Math.min(100, (paidCents / plan.total_amount_cents) * 100)
      : 100

  const hasSchedule =
    plan.installment_count != null &&
    plan.installment_count > 0 &&
    plan.frequency_days != null &&
    plan.first_due_date != null

  const sortedAbonos = plan.abonos
    .slice()
    .sort((a, b) => a.paid_at.localeCompare(b.paid_at))

  // Build installment schedule (only when hasSchedule).
  // Mapping: abonos sorted by paid_at ASC are assigned to installments 1..N in order.
  const today = todayIso()
  type InstallmentState = {
    index: number
    dueDate: string
    expectedCents: number
    status: "paid" | "next" | "future" | "overdue"
    abono: PaymentPlan["abonos"][number] | null
  }

  const installments: InstallmentState[] = (() => {
    if (!hasSchedule) return []
    const count = plan.installment_count as number
    const freq = plan.frequency_days as number
    const start = plan.first_due_date as string
    const expected = plan.installment_amount_cents ?? Math.round(plan.total_amount_cents / count)
    const paidCount = sortedAbonos.length
    // Construir todas las cuotas filtrando las marcadas como deleted.
    // Los abonos se asignan a las cuotas VISIBLES en orden (no a las deleted).
    const visible: Array<{ seq: number; dueDate: string; expectedCents: number }> = []
    for (let i = 0; i < count; i++) {
      const seq = i + 1
      const override = (plan.installment_overrides ?? {})[String(seq)] ?? {}
      if (override.deleted === true) continue
      const dueDate = override.due_date ?? addDaysIso(start, i * freq)
      const expectedCents = override.amount_cents ?? expected
      visible.push({ seq, dueDate, expectedCents })
    }
    let nextAssigned = false
    return visible.map((v, idx) => {
      const abono = idx < paidCount ? sortedAbonos[idx] : null
      let status: InstallmentState["status"]
      // Si el plan está saldado por monto total (balance = 0), pintar todas
      // las cuotas como paid aunque no haya abonos 1-a-1. Caso: cliente paga
      // los $300 en un solo abono pero el schedule mantiene 4 cuotas para
      // seguimiento de citas. Sin esto, las cuotas 2-4 aparecen overdue/future
      // a pesar del "Settled" del footer y confunden a los reps.
      if (isSettled) {
        status = "paid"
      } else if (abono) {
        status = "paid"
      } else if (!nextAssigned) {
        status = cmpDateIso(v.dueDate, today) < 0 ? "overdue" : "next"
        nextAssigned = true
      } else {
        status = cmpDateIso(v.dueDate, today) < 0 ? "overdue" : "future"
      }
      return {
        index: v.seq,
        dueDate: v.dueDate,
        expectedCents: v.expectedCents,
        status,
        abono,
      }
    })
  })()

  const paidInstallments = installments.filter((i) => i.status === "paid").length
  const totalInstallments = installments.length

  async function handleDeleteAbono(abonoId: string) {
    setDeletingId(abonoId)
    try {
      await deleteAbono(abonoId, leadId)
      router.refresh()
    } catch {
      // silently ignore — user can retry
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {isSettled && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />}
            <p className="text-sm font-medium text-gray-800 truncate">{plan.product_name}</p>
          </div>
          {plan.notes && (
            <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{plan.notes}</p>
          )}
        </div>
        <div className="flex items-start gap-3 shrink-0">
          <div className="text-right">
            <p className="text-xs text-gray-400">{t("totalAmount").split(" ")[0]}</p>
            <p className="text-sm font-semibold text-gray-800 tabular-nums">
              {plan.total_amount_cents > 0 ? fmtCents(plan.total_amount_cents) : "—"}
            </p>
          </div>
          <div className="flex items-center gap-1 pt-1">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
              title={tc("edit")}
              disabled={isDeleting}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleDeletePlan}
                  disabled={isDeleting}
                  className="px-1.5 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50 rounded"
                >
                  {isDeleting ? "…" : tc("yes")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={isDeleting}
                  className="px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-gray-100 rounded"
                >
                  {tc("no")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                title={tc("delete")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {plan.total_amount_cents > 0 && (
        <div className="h-1 bg-gray-100">
          <div
            className="h-full transition-all"
            style={{
              width: `${progress}%`,
              background: isSettled ? "#22c55e" : "var(--brand)",
            }}
          />
        </div>
      )}

      {/* Schedule view (when plan has installments) */}
      {hasSchedule && (
        <div className="px-4 py-3 border-b border-gray-100 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500">
              {t("schedule.paidLabel")}{" "}
              <span className="font-semibold text-gray-700 tabular-nums">
                {paidInstallments} / {totalInstallments}
              </span>
            </span>
            {!isSettled && installments.length > 0 && (
              <span className="text-gray-500">
                {t("schedule.nextDue")}:{" "}
                <span className="font-medium text-gray-700 font-mono">
                  {(() => {
                    const next = installments.find(
                      (i) => i.status === "next" || i.status === "overdue"
                    )
                    return next ? fmtDate(next.dueDate) : "—"
                  })()}
                </span>
              </span>
            )}
          </div>
          <div className="flex gap-1 flex-wrap">
            {installments.map((inst) => {
              const cfg = {
                paid: {
                  icon: <CheckCircle2 className="w-3 h-3 text-green-500" />,
                  className: "border-green-200 bg-green-50 text-green-700",
                  label: t("schedule.paidLabel"),
                },
                next: {
                  icon: <Clock className="w-3 h-3 text-amber-500" />,
                  className: "border-amber-300 bg-amber-50 text-amber-700 font-semibold",
                  label: t("schedule.pendingLabel"),
                },
                future: {
                  icon: <Circle className="w-3 h-3 text-gray-300" />,
                  className: "border-gray-200 bg-white text-gray-400",
                  label: t("schedule.futureLabel"),
                },
                overdue: {
                  icon: <AlertCircle className="w-3 h-3 text-red-500" />,
                  className: "border-red-300 bg-red-50 text-red-700 font-semibold",
                  label: t("schedule.overdueLabel"),
                },
              }[inst.status]
              const isClickable = inst.status !== "paid"
              const tooltip = isClickable
                ? `${inst.index}. ${cfg.label} · ${fmtDate(inst.dueDate)} · ${fmtCents(inst.expectedCents)} (click para editar)`
                : `${inst.index}. ${cfg.label} · ${fmtDate(inst.abono?.paid_at ?? inst.dueDate)} · ${fmtCents(inst.expectedCents)}`
              return (
                <button
                  key={inst.index}
                  type="button"
                  disabled={!isClickable}
                  onClick={isClickable ? () => setEditingInstallment(inst.index) : undefined}
                  title={tooltip}
                  className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] tabular-nums transition-all ${cfg.className} ${
                    isClickable ? "cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-amber-300" : "cursor-default"
                  }`}
                >
                  {cfg.icon}
                  <span className="font-mono">{inst.index}</span>
                  <span className="font-mono">
                    {fmtDate(inst.abono?.paid_at ?? inst.dueDate)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Abonos list */}
      <div className="px-4 divide-y divide-gray-100">
        {plan.abonos.length === 0 ? (
          <p className="py-3 text-xs text-gray-400">{t("noPayments")}</p>
        ) : (
          sortedAbonos.map((abono) => (
              <div key={abono.id} className="flex items-center gap-2 py-2">
                <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
                <span className="text-[11px] text-gray-400 w-14 shrink-0 font-mono">
                  {fmtDate(abono.paid_at)}
                </span>
                <span className="text-sm font-medium text-gray-700 tabular-nums flex-1">
                  {fmtCents(abono.amount_cents)}
                </span>
                <span className="text-[10px] text-gray-400 capitalize">{abono.payment_method}</span>
                {abono.notes && (
                  <span className="text-[10px] text-gray-300 truncate max-w-[80px]">{abono.notes}</span>
                )}
                <button
                  type="button"
                  onClick={() => setEditingAbonoId(abono.id)}
                  title={tc("edit")}
                  className="text-gray-200 hover:text-gray-600 transition-colors ml-1"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  disabled={deletingId === abono.id}
                  onClick={() => handleDeleteAbono(abono.id)}
                  className="text-gray-200 hover:text-red-400 transition-colors"
                >
                  {deletingId === abono.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                </button>
              </div>
            ))
        )}
      </div>

      {/* Footer: totals + action */}
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
        <div className="flex gap-4 text-xs">
          <span className="text-gray-400">
            {t("paidSoFar")}{" "}
            <span className="font-semibold text-gray-700 tabular-nums">{fmtCents(paidCents)}</span>
          </span>
          {plan.total_amount_cents > 0 && (
            <span className={balanceCents > 0 ? "text-red-400" : "text-green-500"}>
              {isSettled ? (
                t("settled")
              ) : (
                <>
                  {t("balance")}{" "}
                  <span className="font-semibold tabular-nums">{fmtCents(balanceCents)}</span>
                </>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-gray-500 hover:text-gray-900 cursor-pointer"
            onClick={() => setExtendOpen(true)}
            title="Agregar varias cuotas al final del plan"
          >
            <Plus className="w-3 h-3 mr-1" />
            Agregar pagos
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-gray-500 hover:text-gray-900 cursor-pointer"
            onClick={() => setAddOneOpen(true)}
            title="Agregar un solo pago con fecha y monto custom"
          >
            <Plus className="w-3 h-3 mr-1" />
            Pago manual
          </Button>
          {!isSettled && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-gray-200 text-gray-600 hover:text-gray-900 cursor-pointer"
              onClick={() => setAbonoOpen(true)}
            >
              <Plus className="w-3 h-3 mr-1" />
              {t("addAbonoShort")}
            </Button>
          )}
        </div>
      </div>

      <AddAbonoDialog
        open={abonoOpen}
        onClose={() => setAbonoOpen(false)}
        planId={plan.id}
        leadId={leadId}
        brandId={brandId}
      />

      <EditPlanDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        plan={plan}
        leadId={leadId}
      />

      <ExtendPlanDialog
        open={extendOpen}
        onClose={() => setExtendOpen(false)}
        plan={plan}
        leadId={leadId}
        lastExistingDueDate={
          installments.length > 0
            ? installments[installments.length - 1].dueDate
            : null
        }
      />

      <AddInstallmentDialog
        open={addOneOpen}
        onClose={() => setAddOneOpen(false)}
        plan={plan}
        leadId={leadId}
      />

      {editingInstallment != null && (() => {
        const inst = installments.find((i) => i.index === editingInstallment)
        if (!inst) return null
        const start = plan.first_due_date as string
        const freq = plan.frequency_days as number
        const defaultDueDate = addDaysIso(start, (editingInstallment - 1) * freq)
        const defaultAmountCents =
          plan.installment_amount_cents ??
          (plan.installment_count
            ? Math.round(plan.total_amount_cents / plan.installment_count)
            : 0)
        return (
          <EditInstallmentDialog
            open={true}
            onClose={() => setEditingInstallment(null)}
            planId={plan.id}
            leadId={leadId}
            sequence={editingInstallment}
            currentDueDate={inst.dueDate}
            currentAmountCents={inst.expectedCents}
            defaultDueDate={defaultDueDate}
            defaultAmountCents={defaultAmountCents}
          />
        )
      })()}

      {editingAbonoId != null && (() => {
        const abono = plan.abonos.find((a) => a.id === editingAbonoId)
        if (!abono) return null
        return (
          <EditAbonoDialog
            open={true}
            onClose={() => setEditingAbonoId(null)}
            abonoId={abono.id}
            leadId={leadId}
            initialAmountCents={abono.amount_cents}
            initialPaidAt={abono.paid_at}
            initialMethod={abono.payment_method}
            initialNotes={abono.notes ?? null}
          />
        )
      })()}
    </div>
  )
}

// ── Main Section ──────────────────────────────────────────────────────────────

export function PaymentPlansSection({
  plans,
  leadId,
  brandId,
}: {
  plans: PaymentPlan[]
  leadId: string
  brandId: string
}) {
  const t = useTranslations("plans")

  if (plans.length === 0) return null

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
        {t("title")}
      </p>
      <div className="space-y-3">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} leadId={leadId} brandId={brandId} />
        ))}
      </div>
    </div>
  )
}
