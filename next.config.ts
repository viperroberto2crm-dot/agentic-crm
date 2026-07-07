import createNextIntlPlugin from "next-intl/plugin"
import type { NextConfig } from "next"

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // ESLint corre en `npm run lint` (manual), no bloquea el build de producción.
  // El repo tiene issues de lint pre-existentes; el type-check (tsc) sí gatea.
  eslint: { ignoreDuringBuilds: true },
}

export default withNextIntl(nextConfig)
