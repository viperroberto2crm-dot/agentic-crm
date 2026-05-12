"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import {
  LayoutDashboard,
  Users,
  Phone,
  CalendarDays,
  DollarSign,
  CheckSquare,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sparkles,
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

type NavItem = {
  label: string
  href: string
  icon: LucideIcon
  count?: number
  urgent?: boolean
  badgeTooltip?: string
  roles?: Array<"admin" | "manager" | "rep">
}

export type AppSidebarProps = {
  mobileOpen: boolean
  onMobileClose: () => void
  leadCount: number
  taskCount: number
  urgentTasks: boolean
  userRole: "admin" | "manager" | "rep"
  onOpenCommand: () => void
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    label: "Leads",
    href: "/leads",
    icon: Users,
    badgeTooltip: "Leads activos asignados a ti",
  },
  { label: "Llamadas", href: "/calls", icon: Phone },
  { label: "Citas", href: "/appointments", icon: CalendarDays },
  { label: "Ventas", href: "/sales", icon: DollarSign },
  {
    label: "Tareas",
    href: "/tasks",
    icon: CheckSquare,
    badgeTooltip: "Tareas abiertas · ! = hay urgentes o de alta prioridad",
  },
]

const BOTTOM_ITEMS: NavItem[] = [
  { label: "Settings", href: "/settings", icon: Settings, roles: ["admin", "manager"] },
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
        "group relative flex items-center gap-3 rounded-md text-sm transition-all duration-150 select-none",
        collapsed ? "h-9 w-9 justify-center p-0 mx-auto" : "h-9 px-2.5",
        active
          ? "bg-zinc-900 text-white font-medium"
          : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50"
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
            : "text-zinc-600 group-hover:text-zinc-400"
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
                item.urgent ? "text-amber-400" : "text-zinc-600"
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
            <span className={cn("ml-1.5", item.urgent ? "text-amber-400" : "text-zinc-400")}>
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
  urgentTasks,
  userRole,
  onOpenCommand,
}: SidebarContentProps) {
  const pathname = usePathname()

  const navWithCounts = NAV_ITEMS.map((item) => ({
    ...item,
    count:
      item.href === "/leads" && leadCount > 0
        ? leadCount
        : item.href === "/tasks" && taskCount > 0
        ? taskCount
        : undefined,
    urgent: item.href === "/tasks" ? urgentTasks : undefined,
  }))

  const visibleBottom = BOTTOM_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(userRole)
  )

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div
          className={cn(
            "flex items-center h-[52px] border-b border-zinc-800/60 shrink-0",
            collapsed ? "justify-center" : "px-4"
          )}
        >
          {collapsed ? (
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "hsl(var(--accent))" }} />
          ) : (
            <span className="text-[11px] font-semibold tracking-[0.18em] uppercase text-zinc-600 select-none">
              Agentic CRM
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
            "py-2 border-t border-zinc-800/60 space-y-0.5",
            collapsed ? "px-1.5" : "px-2"
          )}
        >
          {/* Agent Q&A */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onOpenCommand}
                  className="group h-9 w-9 mx-auto flex items-center justify-center rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/50 transition-all"
                >
                  <Sparkles className="w-4 h-4 group-hover:text-[hsl(var(--accent))] transition-colors" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8} className="text-xs">
                Pregúntale al agente
                <kbd className="ml-1.5 font-mono bg-zinc-800 text-zinc-400 border border-zinc-700 rounded px-1 text-[9px]">
                  ⌘K
                </kbd>
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={onOpenCommand}
              className="group flex items-center gap-3 w-full h-9 px-2.5 rounded-md text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50 transition-all"
            >
              <Sparkles className="w-4 h-4 shrink-0 text-zinc-600 group-hover:text-[hsl(var(--accent))] transition-colors" />
              <span className="flex-1 text-left truncate">Pregúntale al agente</span>
              <kbd className="text-[9px] text-zinc-700 font-mono bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 leading-none">
                ⌘K
              </kbd>
            </button>
          )}

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
          "hidden md:flex flex-col h-screen bg-zinc-950 border-r border-zinc-800/60",
          "transition-[width] duration-300 ease-in-out shrink-0 relative",
          collapsed ? "w-14" : "w-60"
        )}
      >
        <SidebarContent collapsed={collapsed} {...props} />

        {/* Collapse toggle */}
        <button
          onClick={toggle}
          className="absolute -right-3 top-[68px] z-10 w-6 h-6 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-600 hover:text-zinc-200 hover:border-zinc-600 transition-all shadow-md"
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
          className="p-0 w-60 bg-zinc-950 border-zinc-800"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navegación</SheetTitle>
          </SheetHeader>
          <SidebarContent collapsed={false} {...props} />
        </SheetContent>
      </Sheet>
    </>
  )
}
