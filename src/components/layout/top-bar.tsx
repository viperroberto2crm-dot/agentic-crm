"use client"

import { useTransition } from "react"
import { useLocale } from "next-intl"
import { Menu } from "lucide-react"
import { useBrand } from "@/context/brand-context"
import { BrandSelector } from "./brand-selector"
import { NotificationBell } from "./notification-bell"
import { AgentPendingTray } from "./agent-pending-tray"
import { AvatarMenu } from "./avatar-menu"
import { setLocale } from "@/app/actions/locale"

type TopBarProps = {
  user: {
    name: string
    email: string
    role: string
    avatar_url: string | null
  }
  unreadCount: number
  pendingCount: number
  onOpenMobile: () => void
  onOpenCommand: () => void
}

export function TopBar({ user, unreadCount, pendingCount, onOpenMobile, onOpenCommand }: TopBarProps) {
  const { activeBrand, brands, setActiveBrand, isAllCompanies, setAllCompanies } = useBrand()
  const locale = useLocale()
  const [, startTransition] = useTransition()

  function toggleLocale() {
    const next = locale === "es" ? "en" : "es"
    startTransition(async () => {
      await setLocale(next)
      window.location.reload()
    })
  }

  return (
    <header className="h-[52px] flex items-center gap-2 px-3 md:px-4 bg-white/90 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-30 shrink-0">
      {/* Mobile hamburger */}
      <button
        onClick={onOpenMobile}
        className="md:hidden w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
        aria-label="Open menu"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Brand selector */}
      <BrandSelector
        brands={brands}
        activeBrand={activeBrand}
        onSelect={setActiveBrand}
        isAllActive={isAllCompanies}
        onSelectAll={setAllCompanies}
      />

      <div className="flex-1" />

      {/* Language toggle */}
      <button
        onClick={toggleLocale}
        className="h-7 px-2.5 rounded text-xs font-semibold border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition-colors tracking-wide"
        title={locale === "es" ? "Switch to English" : "Cambiar a Español"}
      >
        {locale === "es" ? "EN" : "ES"}
      </button>

      {/* Right utilities */}
      <NotificationBell count={unreadCount} />
      <AgentPendingTray
        initialCount={pendingCount}
        visible={user.role === "admin" || user.role === "manager"}
      />
      <AvatarMenu user={user} />
    </header>
  )
}
