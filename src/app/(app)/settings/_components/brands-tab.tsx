"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Plus, Pencil } from "lucide-react"
import { BrandDialog } from "./brand-dialog"
import type { Database } from "@/types/database"

export type BrandRow = Database["public"]["Tables"]["brands"]["Row"]

type Props = {
  brands: BrandRow[]
}

export function BrandsTab({ brands }: Props) {
  const t = useTranslations("brands")
  const [createOpen, setCreateOpen] = useState(false)
  const [editBrand, setEditBrand] = useState<BrandRow | null>(null)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {brands.length} {brands.length === 1 ? t("brandSingular") : t("brandPlural")}
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          {t("newBrand")}
        </Button>
      </div>

      {/* Tabla */}
      {brands.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("noBrands")}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-primary"
            onClick={() => setCreateOpen(true)}
          >
            {t("createFirst")}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t("name")}</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">
                  {t("slug")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">
                  {t("color")}
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t("status")}</th>
                <th className="px-3 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {brands.map((b) => (
                <tr
                  key={b.id}
                  className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
                >
                  <td className="px-3 py-2.5 text-foreground font-medium">{b.name}</td>
                  <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell font-mono text-xs">
                    {b.slug}
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell">
                    {b.brand_color ? (
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-4 h-4 rounded-full border border-border"
                          style={{ background: b.brand_color }}
                          aria-hidden
                        />
                        <span className="font-mono text-xs text-muted-foreground">
                          {b.brand_color}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {b.active ? (
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
                    <button
                      onClick={() => setEditBrand(b)}
                      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title={t("editBrand")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BrandDialog
        mode="create"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      {editBrand && (
        <BrandDialog
          key={editBrand.id}
          mode="edit"
          brand={editBrand}
          open={!!editBrand}
          onClose={() => setEditBrand(null)}
        />
      )}
    </div>
  )
}
