"use client"

import { useState } from "react"
import { BrandProvider, type Brand } from "@/context/brand-context"
import { AppSidebar } from "./app-sidebar"
import { TopBar } from "./top-bar"
import { CommandSearch } from "./command-search"
import { IncomingCallToast } from "@/components/incoming-call-toast"

type AppShellProps = {
  children: React.ReactNode
  brands: Brand[]
  user: {
    name: string
    email: string
    role: string
    avatar_url: string | null
  }
  leadCount: number
  taskCount: number
  messagesUnreadCount: number
  shippingPendingCount: number
  unlinkedCount: number
  urgentTasks: boolean
  unreadCount: number
  pendingCount: number
}

export function AppShell({
  children,
  brands,
  user,
  leadCount,
  taskCount,
  messagesUnreadCount,
  shippingPendingCount,
  unlinkedCount,
  urgentTasks,
  unreadCount,
  pendingCount,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const role = user.role as "admin" | "manager" | "rep" | "provider"

  return (
    <BrandProvider brands={brands}>
      {/* h-dvh: en iPhone h-screen (100vh) mide más que lo visible y esconde el final
          bajo la barra de Safari. Los px de safe-area cubren el notch en horizontal. */}
      <div className="flex h-dvh bg-background overflow-hidden md:p-3 md:gap-3 px-[env(safe-area-inset-left)]">
        <AppSidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
          leadCount={leadCount}
          taskCount={taskCount}
          messagesUnreadCount={messagesUnreadCount}
          shippingPendingCount={shippingPendingCount}
          unlinkedCount={unlinkedCount}
          urgentTasks={urgentTasks}
          userRole={role}
          onOpenCommand={() => setCommandOpen(true)}
        />

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <TopBar
            user={user}
            unreadCount={unreadCount}
            pendingCount={pendingCount}
            onOpenMobile={() => setMobileOpen(true)}
            onOpenCommand={() => setCommandOpen(true)}
          />
          <main className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            {children}
          </main>
        </div>
      </div>

      <CommandSearch
        open={commandOpen}
        onOpenChange={setCommandOpen}
        userRole={role}
      />

      {/* Global screen pop para llamadas entrantes via Supabase Realtime */}
      <IncomingCallToast />
    </BrandProvider>
  )
}
