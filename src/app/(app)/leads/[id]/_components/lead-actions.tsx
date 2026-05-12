"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Trash2, MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { EditLeadModal } from "./edit-lead-modal"
import { RegisterSaleButton } from "./register-sale-button"
import { deleteLead } from "../actions"
import type { Database } from "@/types/database"

type LeadStatus = Database["public"]["Enums"]["lead_status"]
type LeadSource = Database["public"]["Enums"]["lead_source"]

type LeadData = {
  id: string
  brand_id: string
  first_name: string
  last_name: string | null
  phone: string
  phone_alt: string | null
  email: string | null
  status: LeadStatus
  source: LeadSource | null
  assigned_rep_id: string | null
  city: string | null
  state: string | null
  notes: string | null
}

type Rep = { id: string; name: string }

export function LeadActions({
  lead,
  role,
  reps,
}: {
  lead: LeadData
  role: string
  reps: Rep[]
}) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const canDelete = role === "admin" || role === "manager"

  function handleDelete() {
    setDeleteError(null)
    startTransition(async () => {
      try {
        await deleteLead(lead.id)
        router.push("/leads")
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : "Error al borrar")
        setDeleteOpen(false)
      }
    })
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Register sale */}
        <RegisterSaleButton leadId={lead.id} brandId={lead.brand_id} />

        {/* Edit */}
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5 cursor-pointer border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800"
          onClick={() => setEditOpen(true)}
        >
          <Pencil className="w-3.5 h-3.5" />
          Editar
        </Button>

        {/* More (delete) — only admin/manager */}
        {canDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-9 px-2 cursor-pointer border-zinc-700 text-zinc-500 hover:text-white hover:bg-zinc-800"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800">
              <DropdownMenuItem
                className="text-red-400 hover:text-red-300 focus:text-red-300 focus:bg-red-400/10 cursor-pointer gap-2"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Borrar lead
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {deleteError && (
        <p className="text-xs text-red-400">{deleteError}</p>
      )}

      {/* Edit modal */}
      <EditLeadModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        lead={lead}
        reps={reps}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">
              ¿Borrar a {lead.first_name} {lead.last_name ?? ""}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-500">
              Esta acción borra <strong className="text-zinc-300">TODO</strong> el historial: llamadas,
              citas, ventas, suscripciones. <strong className="text-zinc-300">No se puede deshacer.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 text-zinc-400 hover:text-zinc-200 bg-transparent hover:bg-zinc-800">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
              className="bg-red-600 hover:bg-red-700 text-white border-0 cursor-pointer"
            >
              {isPending ? "Borrando…" : "Sí, borrar todo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
