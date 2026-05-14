"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus, Trash2, CheckCircle2, Loader2, Circle, AlertCircle, Clock } from "lucide-react"
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
  createPaymentPlan,
  addAbono,
  deleteAbono,
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

// ── New Plan Dialog ───────────────────────────────────────────────────────────

function NewPlanDialog({
  open,
  onClose,
  leadId,
  brandId,
}: {
  open: boolean
  onClose: () => void
  leadId: string
  brandId: string
}) {
  const t = useTranslations("plans")
  const tc = useTranslations("common")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [productName, setProductName] = useState("")
  const [totalDollars, setTotalDollars] = useState("")
  const [notes, setNotes] = useState("")

  // Schedule fields
  const [scheduleOn, setScheduleOn] = useState(false)
  const [installmentCount, setInstallmentCount] = useState<string>("4")
  const [installmentAmount, setInstallmentAmount] = useState<string>("")
  const [installmentAmountTouched, setInstallmentAmountTouched] = useState(false)
  const [frequency, setFrequency] = useState<string>("7") // 7=weekly, 14=biweekly, 30=monthly, custom
  const [customFrequency, setCustomFrequency] = useState<string>("")
  const [firstDueDate, setFirstDueDate] = useState<string>(todayIso())

  // Auto-calculate installment amount = total / count when user hasn't manually edited.
  const totalNum = parseFloat(totalDollars || "0")
  const countNum = parseInt(installmentCount || "0", 10)
  const autoCalcAmount =
    totalNum > 0 && countNum > 0 ? (totalNum / countNum).toFixed(2) : ""

  const displayedInstallmentAmount = installmentAmountTouched
    ? installmentAmount
    : autoCalcAmount

  const effectiveFrequencyDays =
    frequency === "custom" ? parseInt(customFrequency || "0", 10) : parseInt(frequency, 10)

  function handleClose() {
    setProductName("")
    setTotalDollars("")
    setNotes("")
    setError(null)
    setScheduleOn(false)
    setInstallmentCount("4")
    setInstallmentAmount("")
    setInstallmentAmountTouched(false)
    setFrequency("7")
    setCustomFrequency("")
    setFirstDueDate(todayIso())
    onClose()
  }

  function handleSubmit() {
    if (!productName.trim()) return
    const cents = Math.round(parseFloat(totalDollars || "0") * 100)
    setError(null)

    // Validate schedule fields if enabled.
    let schedulePayload: {
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
      const freqDays = effectiveFrequencyDays
      if (!count || count < 1) {
        setError(t("schedule.installmentCount"))
        return
      }
      if (!amountDollars || amountDollars <= 0) {
        setError(t("schedule.installmentAmount"))
        return
      }
      if (!freqDays || freqDays < 1) {
        setError(t("schedule.frequency"))
        return
      }
      if (!firstDueDate) {
        setError(t("schedule.firstDueDate"))
        return
      }
      schedulePayload = {
        installment_count: count,
        installment_amount_cents: Math.round(amountDollars * 100),
        frequency_days: freqDays,
        first_due_date: firstDueDate,
      }
    }

    startTransition(async () => {
      try {
        await createPaymentPlan({
          lead_id: leadId,
          brand_id: brandId,
          product_name: productName.trim(),
          total_amount_cents: cents,
          notes: notes.trim() || null,
          ...schedulePayload,
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
          <DialogTitle className="text-base font-semibold">{t("newPlan")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">{t("productName")} *</label>
            <Input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder={t("productNamePlaceholder")}
              className="bg-white border-gray-200 text-gray-800 h-9"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">{t("totalAmount")}</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={totalDollars}
              onChange={(e) => setTotalDollars(e.target.value)}
              placeholder="0.00"
              className="bg-white border-gray-200 text-gray-800 h-9 font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">{t("planNotes")}</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("planNotesPlaceholder")}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700 resize-none"
            />
          </div>

          {/* Schedule (optional) */}
          <div className="rounded-md border border-gray-200 bg-gray-50/60">
            <label className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={scheduleOn}
                onChange={(e) => setScheduleOn(e.target.checked)}
                className="h-3.5 w-3.5 accent-zinc-700"
              />
              <span className="text-xs font-medium text-gray-700">
                {t("schedule.enable")}
              </span>
            </label>

            {scheduleOn && (
              <div className="px-3 pb-3 pt-1 space-y-3 border-t border-gray-200">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-gray-500">
                      {t("schedule.installmentCount")} *
                    </label>
                    <Input
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      value={installmentCount}
                      onChange={(e) => setInstallmentCount(e.target.value)}
                      className="bg-white border-gray-200 text-gray-800 h-9 font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-gray-500">
                      {t("schedule.installmentAmount")} *
                    </label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={displayedInstallmentAmount}
                      onChange={(e) => {
                        setInstallmentAmountTouched(true)
                        setInstallmentAmount(e.target.value)
                      }}
                      placeholder="0.00"
                      className="bg-white border-gray-200 text-gray-800 h-9 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-gray-500">
                      {t("schedule.frequency")} *
                    </label>
                    <Select value={frequency} onValueChange={setFrequency}>
                      <SelectTrigger className="bg-white border-gray-200 text-gray-700 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200">
                        <SelectItem value="7" className="text-gray-800">
                          {t("schedule.frequencyWeekly")}
                        </SelectItem>
                        <SelectItem value="14" className="text-gray-800">
                          {t("schedule.frequencyBiweekly")}
                        </SelectItem>
                        <SelectItem value="30" className="text-gray-800">
                          {t("schedule.frequencyMonthly")}
                        </SelectItem>
                        <SelectItem value="custom" className="text-gray-800">
                          {tc("optional")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {frequency === "custom" && (
                      <Input
                        type="number"
                        min="1"
                        max="365"
                        step="1"
                        value={customFrequency}
                        onChange={(e) => setCustomFrequency(e.target.value)}
                        placeholder="days"
                        className="bg-white border-gray-200 text-gray-800 h-9 font-mono mt-1"
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-gray-500">
                      {t("schedule.firstDueDate")} *
                    </label>
                    <Input
                      type="date"
                      value={firstDueDate}
                      onChange={(e) => setFirstDueDate(e.target.value)}
                      className="bg-white border-gray-200 text-gray-800 h-9"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              disabled={isPending || !productName.trim()}
              onClick={handleSubmit}
              className="cursor-pointer"
              style={{ background: "var(--brand)" }}
            >
              {isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  {t("creatingPlan")}
                </>
              ) : (
                t("confirmPlan")
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
  const router = useRouter()
  const [abonoOpen, setAbonoOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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
    let nextAssigned = false
    return Array.from({ length: count }, (_, i) => {
      const dueDate = addDaysIso(start, i * freq)
      const abono = i < paidCount ? sortedAbonos[i] : null
      let status: InstallmentState["status"]
      if (abono) {
        status = "paid"
      } else if (!nextAssigned) {
        // First unpaid -> next or overdue
        status = cmpDateIso(dueDate, today) < 0 ? "overdue" : "next"
        nextAssigned = true
      } else {
        status = cmpDateIso(dueDate, today) < 0 ? "overdue" : "future"
      }
      return { index: i + 1, dueDate, expectedCents: expected, status, abono }
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
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-400">{t("totalAmount").split(" ")[0]}</p>
          <p className="text-sm font-semibold text-gray-800 tabular-nums">
            {plan.total_amount_cents > 0 ? fmtCents(plan.total_amount_cents) : "—"}
          </p>
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
              return (
                <div
                  key={inst.index}
                  title={`${inst.index}. ${cfg.label} · ${fmtDate(
                    inst.abono?.paid_at ?? inst.dueDate
                  )} · ${fmtCents(inst.expectedCents)}`}
                  className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] tabular-nums ${cfg.className}`}
                >
                  {cfg.icon}
                  <span className="font-mono">{inst.index}</span>
                  <span className="font-mono">
                    {fmtDate(inst.abono?.paid_at ?? inst.dueDate)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Abonos list */}
      <div className="px-4 divide-y divide-gray-100">
        {plan.abonos.length === 0 ? (
          <p className="py-3 text-xs text-gray-400">{t("noPlan")}</p>
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
                  disabled={deletingId === abono.id}
                  onClick={() => handleDeleteAbono(abono.id)}
                  className="text-gray-200 hover:text-red-400 transition-colors ml-1"
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

      <AddAbonoDialog
        open={abonoOpen}
        onClose={() => setAbonoOpen(false)}
        planId={plan.id}
        leadId={leadId}
        brandId={brandId}
      />
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
  const [newPlanOpen, setNewPlanOpen] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
          {t("title")}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-border text-muted-foreground hover:text-foreground cursor-pointer"
          onClick={() => setNewPlanOpen(true)}
        >
          <Plus className="w-3 h-3 mr-1" />
          {t("newPlan")}
        </Button>
      </div>

      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noPlan")}</p>
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} leadId={leadId} brandId={brandId} />
          ))}
        </div>
      )}

      <NewPlanDialog
        open={newPlanOpen}
        onClose={() => setNewPlanOpen(false)}
        leadId={leadId}
        brandId={brandId}
      />
    </div>
  )
}
