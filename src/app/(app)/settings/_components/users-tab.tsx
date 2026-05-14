"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
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
  const t = useTranslations("settings")
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editUser, setEditUser] = useState<UserRow | null>(null)

  const ROLE_LABELS: Record<UserRow["role"], string> = {
    admin: t("adminRole"),
    manager: t("managerRole"),
    rep: t("repRole"),
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {users.length !== 1
            ? t("usersCountPlural", { count: users.length })
            : t("usersCount", { count: users.length })}
        </p>
        <Button
          onClick={() => setInviteOpen(true)}
          className="cursor-pointer h-9 text-sm gap-2"
          style={{ background: "var(--brand)" }}
        >
          <UserPlus className="w-4 h-4" />
          {t("inviteUser")}
        </Button>
      </div>

      {users.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          {t("noUsersYet")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("colUser")}
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hidden sm:table-cell">
                  {t("colRole")}
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hidden md:table-cell">
                  {t("colPhone")}
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("colStatus")}
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
                        {t("active")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-zinc-400/10 text-zinc-400 border-zinc-400/20">
                        {t("inactive")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditUser(u)}
                      className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      title={t("editUser")}
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
