"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Lock } from "lucide-react"
import { updateProfile, updateOwnPassword } from "../actions"

const inputCls = "bg-white border-gray-200 text-gray-800 placeholder:text-gray-400 h-9"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      {children}
    </div>
  )
}

export function ProfileForm({
  name,
  email,
  cellPhone,
}: {
  name: string
  email: string
  cellPhone: string | null
}) {
  const t = useTranslations("settings")
  const tc = useTranslations("common")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({ name, cell_phone: cellPhone ?? "" })

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        await updateProfile({ name: form.name, cell_phone: form.cell_phone || null })
        setSaved(true)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("savingError"))
      }
    })
  }

  return (
    <div className="space-y-5 max-w-md">
      <Field label={t("name")}>
        <Input
          className={inputCls}
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
        />
      </Field>

      <Field label={t("email")}>
        <Input
          className={`${inputCls} opacity-50 cursor-not-allowed`}
          value={email}
          disabled
        />
        <p className="text-[11px] text-gray-400 mt-1">{t("emailManagedViaAuth")}</p>
      </Field>

      <Field label={t("phone")}>
        <Input
          className={`${inputCls} font-mono`}
          placeholder="+1 555 000 0000"
          value={form.cell_phone}
          onChange={(e) => setForm((p) => ({ ...p, cell_phone: e.target.value }))}
        />
      </Field>

      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</p>
      )}
      {saved && (
        <p className="text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-3 py-2">
          {t("profileSaved")}
        </p>
      )}

      <Button
        onClick={handleSave}
        disabled={isPending}
        className="cursor-pointer h-9 text-sm"
        style={{ background: "var(--brand)" }}
      >
        {isPending ? t("savingChanges") : t("saveChanges")}
      </Button>

      <div className="pt-8 mt-2 border-t border-gray-200">
        <PasswordChangeSection />
      </div>
    </div>
  )
}

function PasswordChangeSection() {
  const t = useTranslations("settings")
  const ta = useTranslations("auth")
  const tc = useTranslations("common")
  const [isPending, startTransition] = useTransition()
  const [pw, setPw] = useState("")
  const [pw2, setPw2] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function handleSubmit() {
    setError(null)
    setSaved(false)
    if (pw.length < 8) {
      setError(ta("passwordTooShort"))
      return
    }
    if (pw !== pw2) {
      setError(ta("passwordMismatch"))
      return
    }
    startTransition(async () => {
      const result = await updateOwnPassword({ newPassword: pw })
      if (!result.ok) {
        setError(
          result.error === "PASSWORD_TOO_SHORT"
            ? ta("passwordTooShort")
            : result.error,
        )
        return
      }
      setPw("")
      setPw2("")
      setSaved(true)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Lock className="w-4 h-4 text-gray-500" />
        <p className="text-sm font-medium text-gray-700">{t("changePassword")}</p>
      </div>

      <Field label={ta("password")}>
        <Input
          className={inputCls}
          type="password"
          autoComplete="new-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder={t("passwordPlaceholder")}
        />
      </Field>

      <Field label={ta("confirmPassword")}>
        <Input
          className={inputCls}
          type="password"
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          placeholder={t("passwordPlaceholder")}
        />
      </Field>

      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</p>
      )}
      {saved && (
        <p className="text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-3 py-2">
          {t("passwordUpdated")}
        </p>
      )}

      <Button
        onClick={handleSubmit}
        disabled={isPending || !pw || !pw2}
        className="cursor-pointer h-9 text-sm"
        style={{ background: "var(--brand)" }}
      >
        {isPending ? tc("saving") : t("changePassword")}
      </Button>
    </div>
  )
}
