"use client"

import { Menu } from "lucide-react"
import { useBrand } from "@/context/brand-context"
import { BrandSelector } from "./brand-selector"
import { NotificationBell } from "./notification-bell"
import { AvatarMenu } from "./avatar-menu"

type TopBarProps = {
  user: {
    name: string
    email: string
    role: string
    avatar_url: string | null
  }
  unreadCount: number
  onOpenMobile: () => void
  onOpenCommand: () => void
}

export function TopBar({ user, unreadCount, onOpenMobile, onOpenCommand }: TopBarProps) {
  const { activeBrand, brands, setActiveBrand } = useBrand()

  return (
    <header className="h-[52px] flex items-center gap-2 px-3 md:px-4 bg-zinc-950/90 backdrop-blur-sm border-b border-zinc-800/60 sticky top-0 z-30 shrink-0">
      {/* Mobile hamburger */}
      <button
        onClick={onOpenMobile}
        className="md:hidden w-8 h-8 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
        aria-label="Abrir menú"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Brand selector */}
      <BrandSelector
        brands={brands}
        activeBrand={activeBrand}
        onSelect={setActiveBrand}
      />

      <div className="flex-1" />

      {/* Right utilities */}
      <NotificationBell count={unreadCount} />
      <AvatarMenu user={user} />
    </header>
  )
}
