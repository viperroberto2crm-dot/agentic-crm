"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Plus, Pencil, CheckCircle2 } from "lucide-react"
import { ProductDialog } from "./product-dialog"
import type { Database } from "@/types/database"

export type ProductRow = Database["public"]["Tables"]["products"]["Row"]

type Props = {
  products: ProductRow[]
  brandId: string
  categories: string[]
  readonly?: boolean
}

function formatPrice(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}


export function ProductsTab({ products, brandId, categories, readonly = false }: Props) {
  const t = useTranslations("settings")
  const tc = useTranslations("common")
  const [createOpen, setCreateOpen] = useState(false)
  const [editProduct, setEditProduct] = useState<ProductRow | null>(null)

  const CADENCE_LABELS: Record<string, string> = {
    weekly: t("weekly"),
    monthly: t("monthly"),
    annual: t("annual"),
  }

  return (
    <div className="space-y-5">

      {/* ── Header tabla ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("productsCount", { count: products.length })}
        </p>
        {!readonly && (
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            {t("newProduct")}
          </Button>
        )}
      </div>

      {/* ── Tabla ────────────────────────────────────────────────────────── */}
      {products.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("noProducts")}</p>
          {!readonly && (
            <Button variant="ghost" size="sm" className="mt-2 text-primary" onClick={() => setCreateOpen(true)}>
              {t("createFirst")}
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t("productColName")}</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">{t("productColCategory")}</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">{t("productColPrice")}</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">{t("productColCadence")}</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden lg:table-cell">{t("productColServices")}</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">{t("productColRecurring")}</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t("productColStatus")}</th>
                <th className="px-3 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                  <td className="px-3 py-2.5 text-foreground font-medium">
                    <span className="flex items-center gap-1.5">
                      {p.name}
                      {p.best_value && (
                        <span className="text-[10px] bg-accent/15 text-accent border border-accent/25 rounded-full px-1.5 py-0.5 font-medium">
                          ★ Best
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">{p.category}</td>
                  <td className="px-3 py-2.5 text-right text-foreground tabular-nums">
                    <span>{formatPrice(p.price_cents)}</span>
                    {p.display_price_cents && p.display_price_cents > p.price_cents && (
                      <span className="ml-1.5 text-xs text-muted-foreground line-through">
                        {formatPrice(p.display_price_cents)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">
                    {CADENCE_LABELS[p.cadence] ?? p.cadence}
                  </td>
                  <td className="px-3 py-2.5 hidden lg:table-cell">
                    {Array.isArray(p.included_services) && p.included_services.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {(p.included_services as string[]).slice(0, 3).map((s, i) => (
                          <span key={i} className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 shrink-0" />
                            {s}
                          </span>
                        ))}
                        {(p.included_services as string[]).length > 3 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{(p.included_services as string[]).length - 3}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell">
                    <span className={`text-xs font-medium ${p.recurring ? "text-emerald-600" : "text-muted-foreground"}`}>
                      {p.recurring ? tc("yes") : tc("no")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {p.active ? (
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
                        onClick={() => setEditProduct(p)}
                        className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                        title={tc("edit")}
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

      <ProductDialog
        mode="create"
        brandId={brandId}
        categories={categories}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      {editProduct && (
        <ProductDialog
          key={editProduct.id}
          mode="edit"
          product={editProduct}
          brandId={brandId}
          categories={categories}
          open={!!editProduct}
          onClose={() => setEditProduct(null)}
        />
      )}
    </div>
  )
}
