"use client"

import { useState } from "react"
import { BrandProvider, type Brand } from "@/context/brand-context"
import { AppSidebar } from "./app-sidebar"
import { TopBar } from "./top-bar"
import { CommandSearch } from "./command-search"

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
  urgentTasks,
  unreadCount,
  pendingCount,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const role = user.role as "admin" | "manager" | "rep" | "provider"

  return (
    <BrandProvider brands={brands}>
      <div className="flex h-screen bg-gray-50 overflow-hidden">
        <AppSidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
          leadCount={leadCount}
          taskCount={taskCount}
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
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>

      <CommandSearch
        open={commandOpen}
        onOpenChange={setCommandOpen}
        userRole={role}
      />
    </BrandProvider>
  )
}
