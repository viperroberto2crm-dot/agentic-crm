"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"

export default function SetPasswordPage() {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const t = useTranslations("auth")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError(t("passwordMismatch")); return }
    if (password.length < 8) { setError(t("passwordTooShort")); return }

    setLoading(true)
    setError("")
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError(error.message); setLoading(false) }
    else router.push("/dashboard")
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 bg-white border border-gray-200 rounded-lg p-6 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t("setPassword")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("setPasswordSubtitle")}</p>
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            {t("password")}
          </label>
          <input id="password" type="password" required minLength={8} value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:border-gray-500"
          />
        </div>
        <div>
          <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1">
            {t("confirmPassword")}
          </label>
          <input id="confirm" type="password" required minLength={8} value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:border-gray-500"
          />
        </div>
        {error && <p className="text-sm text-rose-500">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded py-2 font-medium transition"
        >
          {loading ? t("saving") : t("createPassword")}
        </button>
      </form>
    </main>
  )
}
