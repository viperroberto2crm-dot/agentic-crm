"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Trash2, KeyRound, Copy, Check, RefreshCw } from "lucide-react"
import { updateUser, deleteUser, resetUserPassword } from "../actions"
import { Field, inputCls } from "./form-primitives"
import type { UserRow } from "./users-tab"

type Props = {
  open: boolean
  onClose: () => void
  user: UserRow
  brandId: string
  currentUserId: string
}

// Alfabeto sin caracteres ambiguos (0/O, 1/l/I) para que se pueda dictar por telefono.
const PWD_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function generatePassword(len = 12) {
  const bytes = new Uint32Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => PWD_ALPHABET[b % PWD_ALPHABET.length]).join("")
}

export function EditUserDialog({ open, onClose, user, brandId, currentUserId }: Props) {
  const t = useTranslations("settings")
  const tc = useTranslations("common")
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: user.name,
    role: user.role,
    active: user.active,
  })

  const isSelf = user.id === currentUserId
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Reset de contrasena (solo admin, seccion independiente del guardado de perfil)
  const [showReset, setShowReset] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [pwdDone, setPwdDone] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pwdPending, startPwdTransition] = useTransition()

  function handleClose() {
    setError(null)
    setConfirmDelete(false)
    setShowReset(false)
    setNewPassword("")
    setPwdError(null)
    setPwdDone(false)
    setCopied(false)
    onClose()
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(newPassword)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setPwdError(t("copyFailed"))
    }
  }

  function handleResetPassword() {
    setPwdError(null)
    setPwdDone(false)
    startPwdTransition(async () => {
      try {
        const res = await resetUserPassword({
          id: user.id,
          brand_id: brandId,
          newPassword,
        })
        if (!res.ok) {
          setPwdError(res.error)
          return
        }
        setPwdDone(true)
      } catch (e) {
        setPwdError(e instanceof Error ? e.message : tc("savingError"))
      }
    })
  }

  function handleDelete() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await deleteUser(user.id, brandId)
        if (!res.ok) {
          setError(res.error)
          setConfirmDelete(false)
          return
        }
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("savingError"))
        setConfirmDelete(false)
      }
    })
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await updateUser({
          id: user.id,
          name: form.name,
          role: form.role,
          active: form.active,
          brand_id: brandId,
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        handleClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("savingError"))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="light-surface bg-white border-border text-foreground max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{t("editUser")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <Field label={t("userEmail")}>
            <Input
              className={`${inputCls} opacity-50 cursor-not-allowed`}
              value={user.email}
              disabled
            />
          </Field>

          <Field label={t("userName")}>
            <Input
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </Field>

          <Field label={t("userRole")}>
            <Select
              value={form.role}
              onValueChange={(v) => setForm((p) => ({ ...p, role: v as typeof form.role }))}
            >
              <SelectTrigger className="h-9 bg-white border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-border">
                <SelectItem value="rep" className="text-foreground">{t("repRole")}</SelectItem>
                <SelectItem value="manager" className="text-foreground">{t("managerRole")}</SelectItem>
                <SelectItem value="provider" className="text-foreground">{t("providerRole")}</SelectItem>
                <SelectItem value="admin" className="text-foreground">{t("adminRole")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("userStatus")}>
            <Select
              value={form.active ? "active" : "inactive"}
              onValueChange={(v) => setForm((p) => ({ ...p, active: v === "active" }))}
              disabled={isSelf}
            >
              <SelectTrigger className="h-9 bg-white border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-border">
                <SelectItem value="active" className="text-foreground">{t("active")}</SelectItem>
                <SelectItem value="inactive" className="text-foreground">{t("inactive")}</SelectItem>
              </SelectContent>
            </Select>
            {isSelf && (
              <p className="text-[11px] text-muted-foreground mt-1">{t("cannotDeactivateSelf")}</p>
            )}
          </Field>

          <div className="border-t border-border pt-4">
            {!showReset ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 -ml-2 text-muted-foreground hover:text-foreground gap-1.5"
                onClick={() => {
                  setShowReset(true)
                  setNewPassword(generatePassword())
                }}
              >
                <KeyRound className="w-3.5 h-3.5" />
                {t("resetPassword")}
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" />
                  {t("resetPassword")}
                </p>

                <div className="flex gap-2">
                  <Input
                    className={inputCls}
                    value={newPassword}
                    autoComplete="new-password"
                    spellCheck={false}
                    onChange={(e) => {
                      setNewPassword(e.target.value)
                      setPwdDone(false)
                      setPwdError(null)
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    title={t("generatePassword")}
                    onClick={() => {
                      setNewPassword(generatePassword())
                      setPwdDone(false)
                      setPwdError(null)
                    }}
                    disabled={pwdPending}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    title={t("copyPassword")}
                    onClick={handleCopy}
                    disabled={!newPassword}
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    size="sm"
                    className="cursor-pointer h-8 text-xs"
                    style={{ background: "var(--brand)" }}
                    onClick={handleResetPassword}
                    disabled={pwdPending || newPassword.length < 8}
                  >
                    {pwdPending ? t("applyingPassword") : t("applyPassword")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-muted-foreground"
                    onClick={() => {
                      setShowReset(false)
                      setNewPassword("")
                      setPwdError(null)
                      setPwdDone(false)
                    }}
                    disabled={pwdPending}
                  >
                    {tc("cancel")}
                  </Button>
                </div>

                {pwdDone ? (
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                    {t("passwordResetDone")}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {t("resetPasswordHint")}
                  </p>
                )}

                {pwdError && (
                  <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-3 py-2">
                    {pwdError}
                  </p>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex gap-3">
              <Button
                onClick={handleSave}
                disabled={isPending || !form.name}
                className="cursor-pointer h-9 text-sm"
                style={{ background: "var(--brand)" }}
              >
                {isPending ? t("savingChanges") : t("saveChanges")}
              </Button>
              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                onClick={handleClose}
                disabled={isPending}
              >
                {tc("cancel")}
              </Button>
            </div>

            {!isSelf && (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-500">{t("confirmDeleteQuestion")}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-red-500 hover:bg-red-50 hover:text-red-600"
                    onClick={handleDelete}
                    disabled={isPending}
                  >
                    {isPending ? t("deleting") : t("confirmDelete")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => setConfirmDelete(false)}
                    disabled={isPending}
                  >
                    {t("deleteNo")}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground hover:text-red-500 hover:bg-red-50 gap-1.5"
                  onClick={() => setConfirmDelete(true)}
                  disabled={isPending}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t("deleteUser")}
                </Button>
              )
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
