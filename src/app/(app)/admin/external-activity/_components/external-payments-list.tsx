"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { Receipt, ArrowRight } from "lucide-react"
import { formatDate } from "@/lib/datetime"

export type ExternalPaymentRow = {
  id: string
  provider: string | null
  amount_cents: number
  currency: string | null
  status: string | null
  items: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  reference: string | null
  paid_at: string | null
  lead_id: string | null
  created_at: string
  /** Resuelto en el server: nombre de la clínica, "Sin Asignar" o "—". */
  brandLabel: string
  /** Resuelto en el server: nombre del lead vinculado (o null). */
  leadName: string | null
}

type Props = {
  payments: ExternalPaymentRow[]
}

function fmtMoney(cents: number, currency: string | null): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency && currency.length === 3 ? currency.toUpperCase() : "USD",
  })
}

function providerLabel(provider: string | null): string {
  if (provider === "square") return "Square"
  if (provider === "stripe") return "Stripe"
  return provider ?? "—"
}

function customerLabel(row: ExternalPaymentRow): string | null {
  return row.customer_name || row.customer_email || row.customer_phone || null
}

function statusChip(status: string | null): { label: string; bg: string; text: string; dot: string } {
  const s = (status ?? "").toLowerCase()
  if (["completed", "complete", "paid", "succeeded", "success"].includes(s))
    return { label: "Pagado", bg: "#E6F3EC", text: "#2E7E5B", dot: "#3FA278" }
  if (["pending", "processing", "requires_payment", "open", "unpaid"].includes(s))
    return { label: "Pendiente", bg: "#FBF1DD", text: "#B67C22", dot: "#D79A3E" }
  if (["refunded", "refund", "reversed", "partially_refunded"].includes(s))
    return { label: "Reembolsado", bg: "#F0EBE0", text: "#7C7259", dot: "#C7B48A" }
  if (["failed", "declined", "canceled", "cancelled", "error"].includes(s))
    return { label: "Fallido", bg: "#FAEBEA", text: "#B85D5B", dot: "#D5807E" }
  // Fallback: neutro cálido con el estado tal cual.
  return {
    label: status ? status.charAt(0).toUpperCase() + status.slice(1) : "—",
    bg: "#F0EBE0",
    text: "#7C7259",
    dot: "#C7B48A",
  }
}

export function ExternalPaymentsList({ payments }: Props) {
  const t = useTranslations("externalActivity")

  if (payments.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#ECE3D3] py-10 text-center">
        <p className="text-sm text-[#93A39D]">{t("noPayments")}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {payments.map((p) => {
        const customer = customerLabel(p)
        const linked = Boolean(p.lead_id)
        // Acento: sin vincular = coral (riesgo de perderse); vinculado = verde.
        const accent = linked ? "#3FA278" : "#EF7B5C"
        const chip = statusChip(p.status)

        return (
          <div
            key={p.id}
            className="relative flex items-center gap-4 rounded-2xl border border-[#ECE3D3] bg-card p-4 pl-5 shadow-[0_1px_2px_rgba(26,46,40,0.04),0_8px_22px_-16px_rgba(26,46,40,0.14)] overflow-hidden transition-shadow hover:shadow-[0_2px_6px_rgba(26,46,40,0.06),0_16px_34px_-18px_rgba(26,46,40,0.22)]"
          >
            <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: accent }} />

            <span
              className="w-11 h-11 rounded-xl grid place-items-center shrink-0"
              style={{ background: "#E6F3EC" }}
            >
              <Receipt className="w-5 h-5" style={{ color: "#2E7E5B" }} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-[15px] text-[#20342C] truncate">
                  {customer || <span className="text-[#B7AE9C]">Sin nombre</span>}
                </span>
                <span
                  className="text-[11px] rounded-full px-2 py-0.5 font-semibold shrink-0 whitespace-nowrap"
                  style={{ backgroundColor: "#F0EBE0", color: "#7C7259" }}
                >
                  {providerLabel(p.provider)}
                </span>
              </div>
              <div className="text-[12.5px] text-[#5C6F68] truncate" title={p.items ?? ""}>
                {p.items || "—"} · {p.brandLabel}
              </div>
              {customer && (p.customer_email || p.customer_phone) && (
                <div className="text-[11.5px] text-[#93A39D] truncate">{p.customer_email || p.customer_phone}</div>
              )}
            </div>

            <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
              <div className="font-semibold text-[17px] text-[#20342C] tabular-nums whitespace-nowrap">
                {fmtMoney(p.amount_cents, p.currency)}
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap"
                  style={{ backgroundColor: chip.bg, color: chip.text }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: chip.dot }} />
                  {chip.label}
                </span>
                {linked ? (
                  <Link
                    href={`/leads/${p.lead_id}`}
                    className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11.5px] font-semibold text-[#2E8B6F] bg-[#E4F2EE] hover:bg-[#D6EBE2] transition-colors max-w-[150px]"
                  >
                    <span className="truncate">{p.leadName || t("viewLead")}</span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-bold text-[#C56A3E] bg-[#FCE9E2] whitespace-nowrap">
                    ⚠ Sin vincular
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[#93A39D] tabular-nums whitespace-nowrap">
                {formatDate(p.paid_at ?? p.created_at)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
