"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Trash2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { updateSale, deleteSale } from "../actions"

type Sale = {
  id: string
  amount_cents: number
  payment_status: "paid" | "pending" | "partial" | "failed" | "refunded"
  payment_method: "cash" | "card" | "stripe"
  notes?: string | null
}

export function SaleActions({
  sale,
  leadId,
  isPlanLinked,
}: {
  sale: Sale
  leadId: string
  isPlanLinked: boolean
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    setIsDeleting(true)
    try {
      await deleteSale(sale.id, leadId)
      router.refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error al borrar")
    } finally {
      setIsDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (isPlanLinked) {
    return (
      <span className="text-[9px] text-gray-300 italic">desde plan</span>
    )
  }

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => setEditOpen(true)}
        className="p-1 rounded hover:bg-gray-100 text-gray-300 hover:text-gray-600 transition-colors"
        title="Editar venta"
        disabled={isDeleting}
      >
        <Pencil className="w-3 h-3" />
      </button>
      {confirmDelete ? (
        <span className="flex items-center gap-1 ml-1">
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="px-1.5 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50 rounded"
          >
            {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Sí"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            disabled={isDeleting}
            className="px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-gray-100 rounded"
          >
            No
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
          title="Borrar venta"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}

      <EditSaleDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        sale={sale}
        leadId={leadId}
      />
    </div>
  )
}

function EditSaleDialog({
  open,
  onClose,
  sale,
  leadId,
}: {
  open: boolean
  onClose: () => void
  sale: Sale
  leadId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState((sale.amount_cents / 100).toFixed(2))
  const [status, setStatus] = useState<Sale["payment_status"]>(sale.payment_status)
  const [method, setMethod] = useState<Sale["payment_method"]>(sale.payment_method)
  const [notes, setNotes] = useState(sale.notes ?? "")

  function handleSubmit() {
    setError(null)
    const cents = Math.round(parseFloat(amount || "0") * 100)
    if (cents < 0 || !Number.isFinite(cents)) {
      setError("Monto inválido")
      return
    }
    startTransition(async () => {
      try {
        await updateSale({
          id: sale.id,
          lead_id: leadId,
          amount_cents: cents,
          payment_status: status,
          payment_method: method,
          notes: notes.trim() || null,
        })
        router.refresh()
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Editar venta</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Monto *</label>
              <Input
                type="number" min="0" step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-white border-gray-200 text-gray-800 h-9 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Status *</label>
              <Select value={status} onValueChange={(v) => setStatus(v as Sale["payment_status"])}>
                <SelectTrigger className="bg-white border-gray-200 text-gray-700 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-gray-200">
                  <SelectItem value="paid" className="text-gray-800">Pagado</SelectItem>
                  <SelectItem value="pending" className="text-gray-800">Pendiente</SelectItem>
                  <SelectItem value="partial" className="text-gray-800">Parcial</SelectItem>
                  <SelectItem value="failed" className="text-gray-800">Fallido</SelectItem>
                  <SelectItem value="refunded" className="text-gray-800">Reembolsado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">Método</label>
            <Select value={method} onValueChange={(v) => setMethod(v as Sale["payment_method"])}>
              <SelectTrigger className="bg-white border-gray-200 text-gray-700 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200">
                <SelectItem value="cash" className="text-gray-800">Cash</SelectItem>
                <SelectItem value="card" className="text-gray-800">Card</SelectItem>
                <SelectItem value="stripe" className="text-gray-800">Stripe</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">Notas</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
              disabled={isPending}
              onClick={handleSubmit}
              className="cursor-pointer"
              style={{ background: "var(--brand)" }}
            >
              {isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />Guardando</>
              ) : "Guardar"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-gray-400 hover:text-gray-700"
              onClick={onClose}
              disabled={isPending}
            >
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
