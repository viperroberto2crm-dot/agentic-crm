"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Plus, Pencil } from "lucide-react"
import { ClinicDialog } from "./clinic-dialog"
import type { Database } from "@/types/database"

export type ClinicRow = Database["public"]["Tables"]["clinics"]["Row"]

type Props = {
  clinics: ClinicRow[]
  brandId: string
  readonly?: boolean
}

function formatAddress(c: ClinicRow): string {
  const parts = [c.address_line1, c.address_line2, c.city, c.state, c.zip].filter(
    (p): p is string => !!p && p.trim().length > 0,
  )
  return parts.join(", ")
}

export function ClinicsTab({ clinics, brandId, readonly = false }: Props) {
  const t = useTranslations("clinics")
  const [createOpen, setCreateOpen] = useState(false)
  const [editClinic, setEditClinic] = useState<ClinicRow | null>(null)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {clinics.length} {clinics.length === 1 ? t("clinicSingular") : t("clinicPlural")}
        </p>
        {!readonly && (
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            {t("newClinic")}
          </Button>
        )}
      </div>

      {/* Tabla */}
      {clinics.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("noClinics")}</p>
          {!readonly && (
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
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t("name")}</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">
                  {t("address")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">
                  {t("phone")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t("status")}</th>
                <th className="px-3 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {clinics.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
                >
                  <td className="px-3 py-2.5 text-foreground font-medium">{c.name}</td>
                  <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">
                    {formatAddress(c) || <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                    {c.phone || <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {c.active ? (
                      <span className="inline-flex items-center text-xs bg-emerald-400/10 text-emerald-600 border border-emerald-400/20 rounded-full px-2 py-0.5 font-medium">
                        {t("active")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs bg-zinc-400/10 text-zinc-400 border border-zinc-400/20 rounded-full px-2 py-0.5 font-medium">
                        {t("inactive")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {!readonly && (
                      <button
                        onClick={() => setEditClinic(c)}
                        className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                        title={t("editClinic")}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ClinicDialog
        mode="create"
        brandId={brandId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      {editClinic && (
        <ClinicDialog
          key={editClinic.id}
          mode="edit"
          clinic={editClinic}
          brandId={brandId}
          open={!!editClinic}
          onClose={() => setEditClinic(null)}
        />
      )}
    </div>
  )
}
