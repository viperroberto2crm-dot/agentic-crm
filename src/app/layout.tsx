import type { Metadata, Viewport } from "next"
import { Albert_Sans, Fraunces, Geist_Mono } from "next/font/google"
import { NextIntlClientProvider } from "next-intl"
import { getMessages, getLocale } from "next-intl/server"
import "./globals.css"

const albertSans = Albert_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
})

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600", "700"],
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: "HORIZON",
  description: "Si Se Pierde / Sunny Slim Wellness Center — CRM",
  // iPhone: "Agregar a pantalla de inicio" abre sin barra de Safari
  appleWebApp: {
    capable: true,
    title: "HORIZON",
    // "default" = barra de estado propia (no se encima sobre el top bar crema)
    statusBarStyle: "default",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // cover = el contenido llega bajo el notch; los insets se respetan con env(safe-area-*)
  viewportFit: "cover",
  themeColor: "#0C3B30",
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} className={`${albertSans.variable} ${fraunces.variable} ${geistMono.variable}`}>
      <body className="bg-background text-foreground antialiased font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
