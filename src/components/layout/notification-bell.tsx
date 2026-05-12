"use client"

import { Bell } from "lucide-react"
import { cn } from "@/lib/utils"

export function NotificationBell({ count }: { count: number }) {
  return (
    <button
      className="relative w-8 h-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
      aria-label={`${count} notificaciones sin leer`}
    >
      <Bell className="w-4 h-4" />
      {count > 0 && (
        <span
          className={cn(
            "absolute top-1 right-1 min-w-[14px] h-[14px] flex items-center justify-center",
            "rounded-full text-[9px] font-bold leading-none px-0.5",
            "bg-[hsl(var(--accent))] text-white tabular-nums"
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  )
}
