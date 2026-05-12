"use client"

import { useState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
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
  return (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "USD" })
}

function ProductCard({
  product,
  onAdd,
}: {
  product: Product
  onAdd: (p: Product) => void
}) {
  const displayPrice = product.display_price_cents ?? product.price_cents
  const isRecurring = product.recurring

  return (
    <button
      type="button"
      onClick={() => onAdd(product)}
      className="relative w-full text-left border border-zinc-800 hover:border-zinc-600 rounded-lg p-3 transition-colors group bg-zinc-900/60 hover:bg-zinc-800/40"
    >
      {product.best_value && (
        <div className="absolute -top-2 right-3">
          <Badge className="text-[9px] px-1.5 py-0 gap-0.5 font-semibold" style={{ background: "var(--brand)", color: "white" }}>
            <Star className="w-2.5 h-2.5" />
            Mejor valor
          </Badge>
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-200 leading-tight">{product.name}</p>
          {product.description && (
            <p className="text-[11px] text-zinc-600 mt-0.5 leading-snug line-clamp-2">
              {product.description}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-zinc-100 tabular-nums">
            {fmtCents(displayPrice)}
            {product.display_unit && (
              <span className="text-[10px] text-zinc-600 font-normal">/{product.display_unit}</span>
            )}
          </p>
          {isRecurring && (
            <p className="text-[10px] text-zinc-600">{product.cadence}</p>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-zinc-700 uppercase tracking-wide">
          {product.category}
        </span>
        <span className="text-[10px] text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity">
          + Agregar
        </span>
      </div>
    </button>
  )
}

function CartLine({
  item,
  onRemove,
  onDiscountChange,
}: {
  item: CartItem
  onRemove: () => void
  onDiscountChange: (cents: number) => void
}) {
  const [discountInput, setDiscountInput] = useState(
    item.discount_cents > 0 ? String(item.discount_cents / 100) : ""
  )

  return (
    <div className="flex items-start gap-2 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-200 leading-tight">{item.product_name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-zinc-600">{fmtCents(item.unit_price_cents)}</span>
          {item.cadence !== "one_time" && (
            <span className="text-[10px] text-zinc-700">· {item.cadence}</span>
          )}
        </div>
      </div>

      {/* Discount input */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-zinc-600">Desc. $</span>
        <input
          type="number"
          min="0"
          value={discountInput}
          onChange={(e) => {
            setDiscountInput(e.target.value)
            const v = parseFloat(e.target.value) || 0
            onDiscountChange(Math.round(v * 100))
          }}
          className="w-16 text-xs text-right bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300 focus:outline-none focus:border-zinc-500"
          placeholder="0"
        />
      </div>

      {/* Line total */}
      <div className="w-20 text-right">
        <p className="text-sm font-medium text-zinc-200 tabular-nums">
          {fmtCents(item.line_total_cents)}
        </p>
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="text-zinc-700 hover:text-red-400 transition-colors mt-0.5"
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
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "stripe">("card")
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "pending">("paid")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Load products when modal opens
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
      setError("Agrega al menos un producto")
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
        setError(e instanceof Error ? e.message : "Error al registrar venta")
      }
    })
  }

  const recurringCount = cart.filter((i) => i.cadence !== "one_time").length

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800/60">
          <DialogTitle className="text-base font-semibold">Registrar venta</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-5">

            {/* Product catalog */}
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-3">
                Productos
              </p>
              {loadingProducts ? (
                <div className="flex items-center gap-2 text-sm text-zinc-600 py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Cargando productos…
                </div>
              ) : products.length === 0 ? (
                <p className="text-sm text-zinc-600 py-2">
                  No hay productos activos para esta marca.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {products.map((p) => (
                    <ProductCard key={p.id} product={p} onAdd={addToCart} />
                  ))}
                </div>
              )}
            </div>

            <Separator className="bg-zinc-800/50" />

            {/* Cart */}
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-3">
                Carrito
                {cart.length > 0 && (
                  <span className="ml-2 text-zinc-600 font-normal">({cart.length})</span>
                )}
              </p>

              {cart.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-zinc-700 py-3">
                  <Plus className="w-4 h-4" />
                  Selecciona productos arriba
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/50">
                  {cart.map((item, i) => (
                    <CartLine
                      key={i}
                      item={item}
                      onRemove={() => removeFromCart(i)}
                      onDiscountChange={(d) => updateDiscount(i, d)}
                    />
                  ))}
                </div>
              )}

              {cart.length > 0 && (
                <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-zinc-800/50">
                  <span className="text-xs text-zinc-500">Total</span>
                  <span className="text-lg font-semibold tabular-nums" style={{ color: "var(--brand)" }}>
                    {fmtCents(total)}
                  </span>
                </div>
              )}

              {recurringCount > 0 && (
                <p className="text-[11px] text-zinc-600 mt-2">
                  {recurringCount} producto{recurringCount !== 1 ? "s" : ""} recurrente
                  {recurringCount !== 1 ? "s" : ""} — se creará suscripción automáticamente.
                </p>
              )}
            </div>

            <Separator className="bg-zinc-800/50" />

            {/* Payment options */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-500">Método de pago</label>
                <Select value={paymentMethod} onValueChange={(v: "cash" | "card" | "stripe") => setPaymentMethod(v)}>
                  <SelectTrigger className="bg-zinc-900 border-zinc-800 text-zinc-300 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-800">
                    <SelectItem value="card" className="text-zinc-200">Tarjeta (terminal)</SelectItem>
                    <SelectItem value="cash" className="text-zinc-200">Efectivo</SelectItem>
                    <SelectItem value="stripe" className="text-zinc-200">Stripe / Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-500">Estado del pago</label>
                <Select value={paymentStatus} onValueChange={(v: "paid" | "pending") => setPaymentStatus(v)}>
                  <SelectTrigger className="bg-zinc-900 border-zinc-800 text-zinc-300 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-800">
                    <SelectItem value="paid" className="text-zinc-200">Pagado</SelectItem>
                    <SelectItem value="pending" className="text-zinc-200">Pendiente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-500">Notas de venta</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Descuento autorizado por, instrucciones especiales…"
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700 resize-none"
              />
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
                {error}
              </p>
            )}

          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-zinc-800/60 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            className="text-zinc-500 hover:text-zinc-300"
            onClick={onClose}
            disabled={isPending}
          >
            Cancelar
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
                Guardando…
              </>
            ) : (
              `Confirmar venta · ${fmtCents(total)}`
            )}
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  )
}
