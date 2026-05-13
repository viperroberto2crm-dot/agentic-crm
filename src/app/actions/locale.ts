"use server"

import { cookies } from "next/headers"

export async function setLocale(locale: string) {
  const safe = ["es", "en"].includes(locale) ? locale : "es"
  const store = await cookies()
  store.set("crm_locale", safe, { path: "/", maxAge: 60 * 60 * 24 * 365 })
}
