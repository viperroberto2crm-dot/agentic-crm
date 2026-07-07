"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Copy, Check } from "lucide-react"
import { inviteUser } from "../actions"
import { Field, inputCls } from "./form-primitives"

type Props = {
  open: boolean
  onClose: () => void
  brandId: string | null
}

function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#"
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
}

export function InviteUserDialog({ open, onClose, brandId }: Props) {
  const t = useTranslations("settings")
  const tc = useTranslations("common")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [done, setDone] = useState<{ name: string; email: string; password: string } | null>(null)
  const [form, setForm] = useState({
    email: "",
    name: "",
    role: "rep" as "admin" | "manager" | "rep" | "provider",
    all_brands: false,
    password: randomPassword(),
  })

  function handleClose() {
    setForm({ email: "", name: "", role: "rep", all_brands: false, password: randomPassword() })
    setError(null)
    setDone(null)
    setCopied(false)
    onClose()
  }

  function copyCredentials() {
    if (!done) return
    navigator.clipboard.writeText(
      `HORIZON\nEmail: ${done.email}\n${t("tempPassword")}: ${done.password}`
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleCreate() {
    setError(null)
    startTransition(async () => {
      const result = await inviteUser({
        email: form.email,
        name: form.name,
        role: form.role,
        brand_id: brandId,
        all_brands: form.all_brands,
        password: form.password,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
      setDone({ name: form.name, email: form.email, password: form.password })
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="light-surface bg-white border-border text-foreground max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {done ? t("userCreated") : t("newUser")}
          </DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-gray-600">
              {t("accountCreatedFor", { name: done.name })}
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-1 font-mono text-sm text-gray-800">
              <p><span className="text-gray-400">Email:</span> {done.email}</p>
              <p><span className="text-gray-400">{t("tempPassword")}:</span> {done.password}</p>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={copyCredentials}
                className="gap-2 cursor-pointer"
                style={{ background: "var(--brand)" }}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? tc("copied") : t("copyCredentials")}
              </Button>
              <Button variant="ghost" className="text-gray-500 hover:text-gray-800" onClick={handleClose}>
                {tc("close")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <Field label={t("userEmail")} required>
              <Input
                className={inputCls}
                type="email"
                placeholder="rep@company.com"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              />
            </Field>

            <Field label={t("userName")} required>
              <Input
                className={inputCls}
                placeholder="John Smith"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </Field>

            <Field label={t("userRole")} required>
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

            <label className="flex items-start gap-2 cursor-pointer select-none rounded-md border border-border bg-gray-50/60 px-3 py-2">
              <input
                type="checkbox"
                checked={form.all_brands || form.role === "admin"}
                disabled={form.role === "admin"}
                onChange={(e) => setForm((p) => ({ ...p, all_brands: e.target.checked }))}
                className="h-3.5 w-3.5 accent-zinc-700 mt-0.5"
              />
              <div className="flex-1">
                <p className="text-xs font-medium text-foreground">Asignar a TODAS las marcas</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {form.role === "admin"
                    ? "Los admins siempre se vinculan a todas las marcas."
                    : "Si está marcado, este usuario podrá ver leads de todas las marcas. Si no, solo de la marca activa."}
                </p>
              </div>
            </label>

            <Field label={t("tempPassword")} required>
              <div className="flex gap-2">
                <Input
                  className={`${inputCls} flex-1 font-mono`}
                  value={form.password}
                  onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Min. 8 characters"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 border-gray-300 text-xs text-gray-600"
                  onClick={() => setForm((p) => ({ ...p, password: randomPassword() }))}
                >
                  {t("generateNew")}
                </Button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">{t("tempPasswordHint")}</p>
            </Field>

            {error && (
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <Button
                onClick={handleCreate}
                disabled={isPending || !form.email || !form.name || form.password.length < 8}
                className="cursor-pointer h-9 text-sm"
                style={{ background: "var(--brand)" }}
              >
                {isPending ? t("creatingUser") : t("createUser")}
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
