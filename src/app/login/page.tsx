import { getTranslations } from "next-intl/server"
import { Sunrise } from "lucide-react"
import { login } from "./actions"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const t = await getTranslations("auth")

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-[#F7F5F0]">
      <form
        action={login}
        className="w-full max-w-sm space-y-6 bg-white border border-[#E8E4DC] rounded-2xl p-8 shadow-[0_1px_2px_rgba(26,46,40,.05),0_8px_28px_rgba(26,46,40,.06)]"
      >
        <div className="flex flex-col items-center text-center space-y-3">
          <span className="flex items-center gap-2.5 select-none">
            <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#FF6B5E] to-[#D9A441] flex items-center justify-center shrink-0">
              <Sunrise className="w-5 h-5 text-white" />
            </span>
            <span className="font-display text-[20px] font-semibold tracking-[0.14em] text-[#1A2E28]">
              {t("title")}
            </span>
          </span>
          <p className="text-sm text-[#5C6F68]">{t("subtitle")}</p>
        </div>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-[#5C6F68] mb-1.5"
            >
              {t("email")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full bg-white border border-[#E8E4DC] rounded-xl px-3.5 py-2.5 text-[#1A2E28] placeholder:text-[#93A39D] focus:outline-none focus:border-[#0E5F4C] focus:ring-2 focus:ring-[#0E5F4C]/15 transition"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[#5C6F68] mb-1.5"
            >
              {t("password")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full bg-white border border-[#E8E4DC] rounded-xl px-3.5 py-2.5 text-[#1A2E28] placeholder:text-[#93A39D] focus:outline-none focus:border-[#0E5F4C] focus:ring-2 focus:ring-[#0E5F4C]/15 transition"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-[#FF6B5E]">
            {error === "invalid" ? t("invalidCredentials") : t("signInError")}
          </p>
        )}

        <button
          type="submit"
          className="w-full bg-[#0E5F4C] hover:bg-[#0A4538] text-white rounded-xl py-2.5 font-medium transition-colors"
        >
          {t("signIn")}
        </button>
      </form>
    </main>
  )
}
