"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { CheckCircle2, Package, Loader2, StickyNote } from "lucide-react"
import { Button } from "@/components/ui/button"
import { approveForShipping, saveProviderNotes, unapproveForShipping } from "../actions"

type Props = {
  appointmentId: string
  /** Status actual de la cita */
  status: string
  /** rol del user actual */
  userRole?: string
  /** Si el provider asignado es el user actual (solo aplica si role=provider) */
  isAssignedProvider: boolean
  /** Estado actual de approval */
  initialApproved: boolean
  initialApprovedAt: string | null
  initialProviderNotes: string | null
  /** Si ya fue marcada como shipped (no se puede des-aprobar) */
  shippedAt: string | null
  /** Callback opcional para cerrar el modal después de aprobar */
  onAfterApprove?: () => void
}

/**
 * Sección dentro del modal Edit Appointment para que el provider apruebe
 * la cita y la marque "Ready to Ship". Solo aparece si:
 *   - status === 'completed'
 *   - rol === 'provider' Y es el provider asignado, O rol === 'admin'/'manager'
 *
 * Si ya está aprobada, muestra el estado + botón para quitar la aprobación
 * (siempre que no esté ya shipped).
 */
export function ApproveForShippingSection({
  appointmentId,
  status,
  userRole,
  isAssignedProvider,
  initialApproved,
  initialApprovedAt,
  initialProviderNotes,
  shippedAt,
  onAfterApprove,
}: Props) {
  const t = useTranslations("appointments")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [notes, setNotes] = useState(initialProviderNotes ?? "")
  const [error, setError] = useState<string | null>(null)

  const canApprove =
    userRole === "admin" ||
    userRole === "manager" ||
    (userRole === "provider" && isAssignedProvider)

  // No mostrar la sección si no aplica
  if (!canApprove) return null
  if (status !== "completed") return null

  // CASO 1: ya shipped → mostrar info read-only
  if (shippedAt) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs space-y-1">
        <p className="font-semibold text-emerald-900 flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" /> {t("alreadyShipped")}
        </p>
        <p className="text-emerald-800">
          {t("shippedAt")}: {new Date(shippedAt).toLocaleString()}
        </p>
        {initialProviderNotes && (
          <p className="text-emerald-700 mt-1 whitespace-pre-wrap">
            <strong>{t("providerNotes")}:</strong> {initialProviderNotes}
          </p>
        )}
      </div>
    )
  }

  // CASO 2: ya aprobada (esperando shipping)
  if (initialApproved) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs space-y-2">
        <p className="font-semibold text-amber-900 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> {t("approved")}
        </p>
        {initialApprovedAt && (
          <p className="text-amber-800">
            {t("approvedAt")}: {new Date(initialApprovedAt).toLocaleString()}
          </p>
        )}
        {initialProviderNotes && (
          <div className="text-amber-700 mt-1 whitespace-pre-wrap bg-white rounded p-2 border border-amber-100">
            {initialProviderNotes}
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] text-amber-700 hover:text-amber-900 hover:bg-amber-100"
          disabled={isPending}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              try {
                await unapproveForShipping(appointmentId)
                router.refresh()
              } catch (e) {
                setError(e instanceof Error ? e.message : "Error")
              }
            })
          }}
        >
          {isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
          {t("unapprove")}
        </Button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  }

  // CASO 3: no aprobada todavía → form de approve
  function handleApprove() {
    if (!notes.trim()) {
      setError("Las notas son requeridas para aprobar el envío")
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await approveForShipping({
          appointment_id: appointmentId,
          provider_notes: notes.trim(),
        })
        router.refresh()
        if (onAfterApprove) onAfterApprove()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error")
      }
    })
  }

  // Guardar SOLO notas: no aprueba, no crea entrada en Shipping
  function handleSaveNotesOnly() {
    if (!notes.trim()) {
      setError("Escribe las notas antes de guardar")
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await saveProviderNotes({
          appointment_id: appointmentId,
          provider_notes: notes.trim(),
        })
        router.refresh()
        if (onAfterApprove) onAfterApprove()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error")
      }
    })
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 space-y-2">
      <div>
        <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" /> {t("approveForShipping")}
        </p>
        <p className="text-[11px] text-amber-700 mt-0.5">
          {t("approveForShippingDesc")}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-amber-900">
          {t("providerNotes")} <span className="text-red-500">*</span>
        </label>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("providerNotesPlaceholder")}
          disabled={isPending}
          className="w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 resize-none"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          onClick={handleApprove}
          disabled={isPending || !notes.trim()}
          className="h-8 bg-amber-600 hover:bg-amber-700 text-white text-xs"
        >
          {isPending ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> ...
            </>
          ) : (
            t("approveAndShip")
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleSaveNotesOnly}
          disabled={isPending || !notes.trim()}
          className="h-8 text-xs border-amber-300 text-amber-800 hover:bg-amber-100 bg-white"
        >
          <StickyNote className="w-3 h-3 mr-1.5" />
          Guardar solo notas (sin envío)
        </Button>
      </div>
      <p className="text-[10px] text-amber-700/80">
        &quot;Guardar solo notas&quot; registra tus notas sin crear envío. Usa &quot;{t("approveAndShip")}&quot; solo cuando la consulta requiere mandar producto.
      </p>

      {error && (
        <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}
    </div>
  )
}
