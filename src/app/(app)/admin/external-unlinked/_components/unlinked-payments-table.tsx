"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Link2, UserPlus } from "lucide-react"
import { formatDate } from "@/lib/datetime"
import {
  LinkLeadDialog,
  type BrandOption,
} from "./link-lead-dialog"

export type UnlinkedPaymentRow = {
  id: string
  provider: string | null
  amount_cents: number
  currency: string | null
  status: string | null
  items: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  customer_address: string | null
  paid_at: string | null
  created_at: string
}

type Props = {
  payments: UnlinkedPaymentRow[]
  brands: BrandOption[]
  defaultBrandId: string | null
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

type OpenState = { id: string; tab: "search" | "create" } | null

export function UnlinkedPaymentsTable({ payments, brands, defaultBrandId }: Props) {
  const t = useTranslations("externalUnlinked")
  const [open, setOpen] = useState<OpenState>(null)

  const active = payments.find((p) => p.id === open?.id) ?? null

  if (payments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-8 text-center">
        <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/40">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                {t("colProvider")}
              </th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                {t("colAmount")}
              </th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">
                {t("colItems")}
              </th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                {t("colCustomer")}
              </th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">
                {t("colDate")}
              </th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr
                key={p.id}
                className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
              >
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center text-[11px] bg-secondary text-muted-foreground border border-border rounded-full px-2 py-0.5 font-medium">
                    {providerLabel(p.provider)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-foreground font-medium tabular-nums whitespace-nowrap">
                  {fmtMoney(p.amount_cents, p.currency)}
                  {p.status && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground capitalize">
                      {p.status}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell max-w-[200px] truncate">
                  {p.items || <span className="text-muted-foreground/50">—</span>}
                </td>
                <td className="px-3 py-2.5 text-foreground">
                  <span className="block truncate max-w-[200px]">
                    {p.customer_name || (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground truncate max-w-[200px]">
                    {p.customer_email || p.customer_phone || ""}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell whitespace-nowrap tabular-nums text-xs">
                  {formatDate(p.paid_at ?? p.created_at)}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => setOpen({ id: p.id, tab: "search" })}
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      {t("linkAction")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => setOpen({ id: p.id, tab: "create" })}
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      {t("createAction")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active && open && (
        <LinkLeadDialog
          key={active.id}
          kind="payment"
          recordId={active.id}
          prefill={{
            name: active.customer_name,
            email: active.customer_email,
            phone: active.customer_phone,
            address: active.customer_address,
          }}
          brands={brands}
          defaultBrandId={defaultBrandId}
          initialTab={open.tab}
          open={!!open}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}
