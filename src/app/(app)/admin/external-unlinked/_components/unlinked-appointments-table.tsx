"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Link2, UserPlus } from "lucide-react"
import { formatApptDateTime, formatDate } from "@/lib/datetime"
import {
  LinkLeadDialog,
  type BrandOption,
} from "./link-lead-dialog"

export type UnlinkedAppointmentRow = {
  id: string
  provider: string | null
  status: string | null
  service: string | null
  staff: string | null
  starts_at: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  customer_address: string | null
  created_at: string
}

type Props = {
  appointments: UnlinkedAppointmentRow[]
  brands: BrandOption[]
  defaultBrandId: string | null
}

function providerLabel(provider: string | null): string {
  if (provider === "square") return "Square"
  if (provider === "stripe") return "Stripe"
  return provider ?? "—"
}

type OpenState = { id: string; tab: "search" | "create" } | null

export function UnlinkedAppointmentsTable({
  appointments,
  brands,
  defaultBrandId,
}: Props) {
  const t = useTranslations("externalUnlinked")
  const [open, setOpen] = useState<OpenState>(null)

  const active = appointments.find((a) => a.id === open?.id) ?? null

  if (appointments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-8 text-center">
        <p className="text-sm text-muted-foreground">{t("noAppointments")}</p>
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
                {t("colService")}
              </th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                {t("colCustomer")}
              </th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">
                {t("colWhen")}
              </th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {appointments.map((a) => (
              <tr
                key={a.id}
                className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
              >
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center text-[11px] bg-secondary text-muted-foreground border border-border rounded-full px-2 py-0.5 font-medium">
                    {providerLabel(a.provider)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-foreground">
                  <span className="block truncate max-w-[200px]">
                    {a.service || <span className="text-muted-foreground/50">—</span>}
                    {a.staff && (
                      <span className="text-muted-foreground"> · {a.staff}</span>
                    )}
                  </span>
                  {a.status && (
                    <span className="block text-[10px] text-muted-foreground capitalize">
                      {a.status}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-foreground">
                  <span className="block truncate max-w-[200px]">
                    {a.customer_name || (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground truncate max-w-[200px]">
                    {a.customer_email || a.customer_phone || ""}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell whitespace-nowrap tabular-nums text-xs">
                  {a.starts_at
                    ? formatApptDateTime(a.starts_at)
                    : formatDate(a.created_at)}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => setOpen({ id: a.id, tab: "search" })}
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      {t("linkAction")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => setOpen({ id: a.id, tab: "create" })}
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
          kind="appointment"
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
