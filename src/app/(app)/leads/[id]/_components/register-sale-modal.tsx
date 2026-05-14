"use client"

import { useState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, Trash2, Star, Loader2 } from "lucide-react"
import { fetchProducts, registerSale } from "../actions"
import type { RegisterSaleInput } from "../actions"

type Product = Awaited<ReturnType<typeof fetchProducts>>[number]

type CartItem = {
  product_id: string | null
  product_name: string
  product_category: string
  cadence: string
  billing_cycle_days: number | null
  quantity: number
  unit_price_cents: number
  discount_cents: number
  line_total_cents: number
  notes: string | null
}

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function ProductCard({
  product,
  onAdd,
  bestValueLabel,
  addLabel,
}: {
  product: Product
  onAdd: (p: Product) => void
  bestValueLabel: string
  addLabel: string
}) {
  const displayPrice = product.display_price_cents ?? product.price_cents
  const isRecurring = product.recurring

  return (
    <button
      type="button"
      onClick={() => onAdd(product)}
      className="relative w-full text-left border border-gray-200 hover:border-zinc-600 rounded-lg p-3 transition-colors group bg-white hover:bg-gray-100"
    >
      {product.best_value && (
        <div className="absolute -top-2 right-3">
          <Badge className="text-[9px] px-1.5 py-0 gap-0.5 font-semibold" style={{ background: "var(--brand)", color: "white" }}>
            <Star className="w-2.5 h-2.5" />
            {bestValueLabel}
          </Badge>
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 leading-tight">{product.name}</p>
          {product.description && (
            <p className="text-[11px] text-gray-400 mt-0.5 leading-snug line-clamp-2">
              {product.description}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-gray-900 tabular-nums">
            {fmtCents(displayPrice)}
            {product.display_unit && (
              <span className="text-[10px] text-gray-400 font-normal">/{product.display_unit}</span>
            )}
          </p>
          {isRecurring && (
            <p className="text-[10px] text-gray-400">{product.cadence}</p>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-gray-300 uppercase tracking-wide">
          {product.category}
        </span>
        <span className="text-[10px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
          {addLabel}
        </span>
      </div>
    </button>
  )
}

function CartLine({
  item,
  discountLabel,
  onRemove,
  onDiscountChange,
}: {
  item: CartItem
  discountLabel: string
  onRemove: () => void
  onDiscountChange: (cents: number) => void
}) {
  const [discountInput, setDiscountInput] = useState(
    item.discount_cents > 0 ? String(item.discount_cents / 100) : ""
  )

  return (
    <div className="flex items-start gap-2 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 leading-tight">{item.product_name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-gray-400">{fmtCents(item.unit_price_cents)}</span>
          {item.cadence !== "one_time" && (
            <span className="text-[10px] text-gray-300">· {item.cadence}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-400">{discountLabel}</span>
        <input
          type="number"
          min="0"
          value={discountInput}
          onChange={(e) => {
            setDiscountInput(e.target.value)
            const v = parseFloat(e.target.value) || 0
            onDiscountChange(Math.round(v * 100))
          }}
          className="w-16 text-xs text-right bg-gray-100 border border-gray-300 rounded px-1.5 py-0.5 text-gray-700 focus:outline-none focus:border-zinc-500"
          placeholder="0"
        />
      </div>

      <div className="w-20 text-right">
        <p className="text-sm font-medium text-gray-800 tabular-nums">
          {fmtCents(item.line_total_cents)}
        </p>
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="text-gray-300 hover:text-red-400 transition-colors mt-0.5"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export function RegisterSaleModal({
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
  const t = useTranslations("sales")
  const tc = useTranslations("common")
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "stripe">("card")
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "pending">("paid")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setLoadingProducts(true)
    fetchProducts(brandId)
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setLoadingProducts(false))
  }, [open, brandId])

  function addToCart(product: Product) {
    const price = product.display_price_cents ?? product.price_cents
    setCart((prev) => [
      ...prev,
      {
        product_id: product.id,
        product_name: product.name,
        product_category: product.category,
        cadence: product.cadence,
        billing_cycle_days: product.billing_cycle_days,
        quantity: 1,
        unit_price_cents: price,
        discount_cents: 0,
        line_total_cents: price,
        notes: null,
      },
    ])
  }

  function removeFromCart(idx: number) {
    setCart((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateDiscount(idx: number, discountCents: number) {
    setCart((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item
        const line = Math.max(0, item.unit_price_cents * item.quantity - discountCents)
        return { ...item, discount_cents: discountCents, line_total_cents: line }
      })
    )
  }

  const total = cart.reduce((s, i) => s + i.line_total_cents, 0)

  function handleSubmit() {
    if (cart.length === 0) {
      setError(t("addAtLeastOne"))
      return
    }
    setError(null)

    const payload: RegisterSaleInput = {
      lead_id: leadId,
      brand_id: brandId,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      notes: notes.trim() || null,
      items: cart,
    }

    startTransition(async () => {
      try {
        await registerSale(payload)
        setCart([])
        setNotes("")
        onClose()
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("savingError"))
      }
    })
  }

  const recurringCount = cart.filter((i) => i.cadence !== "one_time").length

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-gray-200">
          <DialogTitle className="text-base font-semibold">{t("registerSale")}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-5">

            <div>
              <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold mb-3">
                {t("products")}
              </p>
              {loadingProducts ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("loadingProducts")}
                </div>
              ) : products.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">
                  {t("noProducts")}
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {products.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      onAdd={addToCart}
                      bestValueLabel={t("bestValue")}
                      addLabel={t("addToCart")}
                    />
                  ))}
                </div>
              )}
            </div>

            <Separator className="bg-gray-100" />

            <div>
              <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold mb-3">
                {t("cart")}
                {cart.length > 0 && (
                  <span className="ml-2 text-gray-400 font-normal">({cart.length})</span>
                )}
              </p>

              {cart.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-gray-300 py-3">
                  <Plus className="w-4 h-4" />
                  {t("selectProducts")}
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {cart.map((item, i) => (
                    <CartLine
                      key={i}
                      item={item}
                      discountLabel={t("discount")}
                      onRemove={() => removeFromCart(i)}
                      onDiscountChange={(d) => updateDiscount(i, d)}
                    />
                  ))}
                </div>
              )}

              {cart.length > 0 && (
                <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-gray-200">
                  <span className="text-xs text-gray-400">{t("total")}</span>
                  <span className="text-lg font-semibold tabular-nums" style={{ color: "var(--brand)" }}>
                    {fmtCents(total)}
                  </span>
                </div>
              )}

              {recurringCount > 0 && (
                <p className="text-[11px] text-gray-400 mt-2">
                  {t("recurringNote", { count: recurringCount, plural: recurringCount !== 1 ? "s" : "" })}
                </p>
              )}
            </div>

            <Separator className="bg-gray-100" />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">{t("paymentMethod")}</label>
                <Select value={paymentMethod} onValueChange={(v: "cash" | "card" | "stripe") => setPaymentMethod(v)}>
                  <SelectTrigger className="bg-white border-gray-200 text-gray-700 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-gray-200">
                    <SelectItem value="card" className="text-gray-800">{t("card")}</SelectItem>
                    <SelectItem value="cash" className="text-gray-800">{t("cash")}</SelectItem>
                    <SelectItem value="stripe" className="text-gray-800">{t("stripe")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">{t("paymentStatus")}</label>
                <Select value={paymentStatus} onValueChange={(v: "paid" | "pending") => setPaymentStatus(v)}>
                  <SelectTrigger className="bg-white border-gray-200 text-gray-700 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-gray-200">
                    <SelectItem value="paid" className="text-gray-800">{t("paid")}</SelectItem>
                    <SelectItem value="pending" className="text-gray-800">{t("pending")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">{t("saleNotes")}</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("saleNotesPlaceholder")}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700 resize-none"
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
                {error}
              </p>
            )}

          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            className="text-gray-400 hover:text-gray-700"
            onClick={onClose}
            disabled={isPending}
          >
            {tc("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || cart.length === 0}
            className="gap-2 cursor-pointer"
            style={{ background: "var(--brand)" }}
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {tc("saving")}
              </>
            ) : (
              t("confirmSale", { total: fmtCents(total) })
            )}
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  )
}
