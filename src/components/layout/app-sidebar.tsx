"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  LayoutDashboard,
  Users,
  Phone,
  CalendarDays,
  DollarSign,
  CheckSquare,
  CalendarClock,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Package,
  Sunrise,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

type UserRole = "admin" | "manager" | "rep" | "provider"

type NavItem = {
  label: string
  href: string
  icon: LucideIcon
  count?: number
  urgent?: boolean
  badgeTooltip?: string
  roles?: Array<UserRole>
}

export type AppSidebarProps = {
  mobileOpen: boolean
  onMobileClose: () => void
  leadCount: number
  taskCount: number
  shippingPendingCount: number
  urgentTasks: boolean
  userRole: UserRole
  onOpenCommand: () => void
}

// Providers tienen una vista restringida: solo Appointments y Leads.
const PROVIDER_ALLOWED_HREFS = new Set<string>(["/appointments", "/leads"])

// Shipping solo lo ven admin y manager (no rep, no provider).
const ADMIN_MANAGER_ONLY_HREFS = new Set<string>(["/shipping"])

const NAV_HREFS = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "leads", href: "/leads", icon: Users, hasBadge: true },
  { key: "calls", href: "/calls", icon: Phone },
  { key: "appointments", href: "/appointments", icon: CalendarDays },
  { key: "shipping", href: "/shipping", icon: Package, hasBadge: true },
  { key: "sales", href: "/sales", icon: DollarSign },
  { key: "paymentsDue", href: "/payments-due", icon: CalendarClock },
  { key: "tasks", href: "/tasks", icon: CheckSquare, hasBadge: true },
]

const BOTTOM_HREFS = [
  { key: "settings", href: "/settings", icon: Settings },
]

function NavLink({
  item,
  collapsed,
  onOpenCommand,
}: {
  item: NavItem & { count?: number; urgent?: boolean }
  collapsed: boolean
  onOpenCommand?: () => void
}) {
  const pathname = usePathname()
  const active =
    pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"))
  const Icon = item.icon

  const inner = (
    <Link
      href={item.href}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl text-sm transition-all duration-150 select-none",
        collapsed ? "h-9 w-9 justify-center p-0 mx-auto" : "h-9 px-2.5",
        active
          ? "bg-white/15 text-white font-medium"
          : "text-white/60 hover:text-white hover:bg-white/10"
      )}
    >
      {active && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full"
          style={{ backgroundColor: "hsl(var(--accent))" }}
        />
      )}
      <Icon
        className={cn(
          "w-4 h-4 shrink-0 transition-colors",
          active
            ? "text-[hsl(var(--accent))]"
            : "text-white/50 group-hover:text-white"
        )}
      />
      {!collapsed && (
        <span className="flex-1 truncate leading-none">{item.label}</span>
      )}
      {!collapsed && item.count !== undefined && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "text-[10px] font-semibold tabular-nums leading-none font-mono",
                item.urgent ? "text-amber-400" : "text-white/50"
              )}
            >
              {item.count}
              {item.urgent ? "!" : ""}
            </span>
          </TooltipTrigger>
          {item.badgeTooltip && (
            <TooltipContent side="right" className="text-xs max-w-[200px]">
              {item.badgeTooltip}
            </TooltipContent>
          )}
        </Tooltip>
      )}
    </Link>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8} className="text-xs">
          {item.label}
          {item.count !== undefined && (
            <span className={cn("ml-1.5", item.urgent ? "text-amber-400" : "text-white/60")}>
              · {item.count}
              {item.urgent ? "!" : ""}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    )
  }

  return inner
}

type SidebarContentProps = Omit<AppSidebarProps, "mobileOpen" | "onMobileClose"> & {
  collapsed: boolean
}

function SidebarContent({
  collapsed,
  leadCount,
  taskCount,
  shippingPendingCount,
  urgentTasks,
  userRole,
  onOpenCommand,
}: SidebarContentProps) {
  const pathname = usePathname()
  const t = useTranslations("nav")

  const isProvider = userRole === "provider"
  const isAdminOrManager = userRole === "admin" || userRole === "manager"

  const navWithCounts: NavItem[] = NAV_HREFS.map((item) => ({
    label: t(item.key as Parameters<typeof t>[0]),
    href: item.href,
    icon: item.icon,
    count:
      item.href === "/leads" && leadCount > 0
        ? leadCount
        : item.href === "/tasks" && taskCount > 0
        ? taskCount
        : item.href === "/shipping" && shippingPendingCount > 0
        ? shippingPendingCount
        : undefined,
    urgent:
      item.href === "/tasks"
        ? urgentTasks
        : item.href === "/shipping"
        ? shippingPendingCount > 0
        : undefined,
    badgeTooltip: undefined,
  })).filter((item) => {
    if (isProvider) return PROVIDER_ALLOWED_HREFS.has(item.href)
    // Shipping solo para admin/manager
    if (ADMIN_MANAGER_ONLY_HREFS.has(item.href) && !isAdminOrManager) return false
    return true
  })

  const visibleBottom: NavItem[] = BOTTOM_HREFS.map((item) => ({
    label: t(item.key as Parameters<typeof t>[0]),
    href: item.href,
    icon: item.icon,
  })).filter(() => !isProvider)

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div
          className={cn(
            "flex items-center h-[52px] border-b border-white/10 shrink-0",
            collapsed ? "justify-center" : "px-4"
          )}
        >
          {collapsed ? (
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#FF6B5E] to-[#D9A441] flex items-center justify-center shrink-0">
              <Sunrise className="w-4 h-4 text-white" />
            </span>
          ) : (
            <span className="flex items-center gap-2.5 select-none">
              <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#FF6B5E] to-[#D9A441] flex items-center justify-center shrink-0">
                <Sunrise className="w-4 h-4 text-white" />
              </span>
              <span className="font-display text-[15px] font-semibold tracking-[0.14em] text-white">
                HORIZON
              </span>
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
          <ul
            className={cn(
              "space-y-0.5",
              collapsed ? "px-1.5" : "px-2"
            )}
          >
            {navWithCounts.map((item) => (
              <li key={item.href}>
                <NavLink
                  item={item}
                  collapsed={collapsed}
                  onOpenCommand={onOpenCommand}
                />
              </li>
            ))}
          </ul>
        </nav>

        {/* Bottom */}
        <div
          className={cn(
            "py-2 border-t border-white/10 space-y-0.5",
            collapsed ? "px-1.5" : "px-2"
          )}
        >
          {/* Agent Q&A — oculto para provider (vista restringida) */}
          {!isProvider && (collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onOpenCommand}
                  className="group h-9 w-9 mx-auto flex items-center justify-center rounded-xl text-white/50 hover:text-white hover:bg-white/10 transition-all"
                >
                  <Sparkles className="w-4 h-4 group-hover:text-[hsl(var(--accent))] transition-colors" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8} className="text-xs">
                {t("askAgent")}
                <kbd className="ml-1.5 font-mono bg-white/10 text-white/70 border border-white/20 rounded px-1 text-[9px]">
                  ⌘K
                </kbd>
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={onOpenCommand}
              className="group flex items-center gap-3 w-full h-9 px-2.5 rounded-xl text-sm text-white/60 hover:text-white hover:bg-white/10 transition-all"
            >
              <Sparkles className="w-4 h-4 shrink-0 text-white/50 group-hover:text-[hsl(var(--accent))] transition-colors" />
              <span className="flex-1 text-left truncate">{t("askAgent")}</span>
              <kbd className="text-[9px] text-white/50 font-mono bg-white/5 border border-white/10 rounded px-1 py-0.5 leading-none">
                ⌘K
              </kbd>
            </button>
          ))}

          {visibleBottom.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              collapsed={collapsed}
            />
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}

export function AppSidebar({
  mobileOpen,
  onMobileClose,
  ...props
}: AppSidebarProps) {
  const t = useTranslations("nav")
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem("sidebarCollapsed")
    if (stored === "true") setCollapsed(true)
  }, [])

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem("sidebarCollapsed", String(next))
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col h-screen bg-[#0A4538] border-r border-white/10",
          "transition-[width] duration-300 ease-in-out shrink-0 relative",
          collapsed ? "w-14" : "w-60"
        )}
      >
        <SidebarContent collapsed={collapsed} {...props} />

        {/* Collapse toggle */}
        <button
          onClick={toggle}
          className="absolute -right-3 top-[68px] z-10 w-6 h-6 rounded-full bg-[#0A4538] border border-white/20 flex items-center justify-center text-white/60 hover:text-white hover:border-white/40 transition-all shadow-md"
          aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronLeft className="w-3 h-3" />
          )}
        </button>
      </aside>

      {/* Mobile sidebar — Sheet */}
      <Sheet open={mobileOpen} onOpenChange={(v) => !v && onMobileClose()}>
        <SheetContent
          side="left"
          className="p-0 w-60 bg-[#0A4538] border-white/10"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{t("navigation")}</SheetTitle>
          </SheetHeader>
          <SidebarContent collapsed={false} {...props} />
        </SheetContent>
      </Sheet>
    </>
  )
}
