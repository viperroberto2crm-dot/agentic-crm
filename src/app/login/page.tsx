import { getTranslations } from "next-intl/server"
import { login } from "./actions"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const t = await getTranslations("auth")

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form
        action={login}
        className="w-full max-w-sm space-y-4 bg-zinc-900 border border-zinc-800 rounded-lg p-6"
      >
        <div>
          <h1 className="text-xl font-semibold text-white">{t("title")}</h1>
          <p className="text-sm text-zinc-400 mt-1">{t("subtitle")}</p>
        </div>

        <div>
          <label htmlFor="email" className="block text-sm text-zinc-300 mb-1">
            {t("email")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm text-zinc-300 mb-1">
            {t("password")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
          />
        </div>

        {error && (
          <p className="text-sm text-rose-400">
            {error === "invalid" ? t("invalidCredentials") : t("signInError")}
          </p>
        )}

        <button
          type="submit"
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white rounded py-2 font-medium transition"
        >
          {t("signIn")}
        </button>
      </form>
    </main>
  )
}
