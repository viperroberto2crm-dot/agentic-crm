"use client"

import { useTranslations } from "next-intl"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { LogOut, User } from "lucide-react"
import { signOut } from "@/app/auth/actions"

type UserProfile = {
  name: string
  email: string
  role: string
  avatar_url: string | null
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
}

export function AvatarMenu({ user }: { user: UserProfile }) {
  const tCommon = useTranslations("common")
  const tAuth = useTranslations("auth")
  const tSettings = useTranslations("settings")

  const roleLabel =
    user.role === "admin"
      ? tSettings("adminRole")
      : user.role === "manager"
        ? tSettings("managerRole")
        : user.role === "rep"
          ? tSettings("repRole")
          : user.role

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <Avatar className="w-7 h-7 cursor-pointer">
            {user.avatar_url && <AvatarImage src={user.avatar_url} alt={user.name} />}
            <AvatarFallback className="bg-secondary text-secondary-foreground text-[10px] font-semibold">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 bg-popover border-border shadow-lg shadow-[#1A2E28]/10"
      >
        <DropdownMenuLabel className="pb-1">
          <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-mono uppercase tracking-wide">
            {roleLabel}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem
          asChild
          className="text-foreground focus:text-[#0A4538] cursor-pointer gap-2"
        >
          <a href="/settings">
            <User className="w-3.5 h-3.5" />
            {tCommon("myProfile")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem asChild className="text-muted-foreground hover:text-[#FF6B5E] focus:text-[#FF6B5E] cursor-pointer gap-2">
          <form action={signOut}>
            <button type="submit" className="flex items-center gap-2 w-full">
              <LogOut className="w-3.5 h-3.5" />
              {tAuth("signOut")}
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
