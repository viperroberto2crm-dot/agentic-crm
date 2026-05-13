"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { UserPlus, Pencil } from "lucide-react"
import { InviteUserDialog } from "./invite-user-dialog"
import { EditUserDialog } from "./edit-user-dialog"

export type UserRow = {
  id: string
  name: string
  email: string
  role: "admin" | "manager" | "rep"
  cell_phone: string | null
  active: boolean
  created_at: string
}

const ROLE_LABELS: Record<UserRow["role"], string> = {
  admin: "Admin",
  manager: "Manager",
  rep: "Rep",
}

const ROLE_CLASS: Record<UserRow["role"], string> = {
  admin: "bg-rose-400/10 text-rose-600 border-rose-400/20",
  manager: "bg-blue-400/10 text-blue-600 border-blue-400/20",
  rep: "bg-emerald-400/10 text-emerald-600 border-emerald-400/20",
}

type Props = {
  users: UserRow[]
  brandId: string
  currentUserId: string
}

export function UsersTab({ users, brandId, currentUserId }: Props) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editUser, setEditUser] = useState<UserRow | null>(null)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {users.length} {users.length === 1 ? "usuario" : "usuarios"} en esta marca
        </p>
        <Button
          onClick={() => setInviteOpen(true)}
          className="cursor-pointer h-9 text-sm gap-2"
          style={{ background: "var(--brand)" }}
        >
          <UserPlus className="w-4 h-4" />
          Invitar usuario
        </Button>
      </div>

      {/* Table */}
      {users.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          Aún no hay usuarios en esta marca. Invita a tu primer rep.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Usuario
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hidden sm:table-cell">
                  Rol
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hidden md:table-cell">
                  Teléfono
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Estado
                </th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ROLE_CLASS[u.role]}`}
                    >
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell font-mono text-xs">
                    {u.cell_phone ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {u.active ? (
                      <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-emerald-400/10 text-emerald-600 border-emerald-400/20">
                        Activo
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-zinc-400/10 text-zinc-400 border-zinc-400/20">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditUser(u)}
                      className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      title="Editar usuario"
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

      <InviteUserDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        brandId={brandId}
      />

      {editUser && (
        <EditUserDialog
          key={editUser.id}
          open={!!editUser}
          onClose={() => setEditUser(null)}
          user={editUser}
          brandId={brandId}
          currentUserId={currentUserId}
        />
      )}
    </div>
  )
}
