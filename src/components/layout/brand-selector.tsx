"use client"

import { useTranslations } from "next-intl"
import { ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { Brand } from "@/context/brand-context"

const BRAND_COLORS: Record<string, string> = {
  "si-se-pierde": "#E11D48",
  "sunny-slim": "#F59E0B",
}

type BrandSelectorProps = {
  brands: Brand[]
  activeBrand: Brand | null
  onSelect: (brand: Brand) => void
}

export function BrandSelector({ brands, activeBrand, onSelect }: BrandSelectorProps) {
  const t = useTranslations("common")
  if (!activeBrand) return null

  const activeColor =
    activeBrand.brand_color ?? BRAND_COLORS[activeBrand.slug] ?? "#3B82F6"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-zinc-300 hover:text-white hover:bg-zinc-800/60 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]">
          <span
            className="w-2 h-2 rounded-full shrink-0 transition-colors duration-300"
            style={{ backgroundColor: activeColor }}
          />
          <span className="font-medium max-w-[160px] truncate">{activeBrand.name}</span>
          <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52 bg-zinc-900 border-zinc-800 shadow-xl shadow-black/40"
      >
        {brands.map((brand) => {
          const color = brand.brand_color ?? BRAND_COLORS[brand.slug] ?? "#3B82F6"
          const isActive = brand.id === activeBrand.id
          return (
            <DropdownMenuItem
              key={brand.id}
              onClick={() => onSelect(brand)}
              className={cn(
                "flex items-center gap-2.5 cursor-pointer text-sm",
                isActive
                  ? "text-white bg-zinc-800"
                  : "text-zinc-400 hover:text-white focus:text-white"
              )}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="truncate">{brand.name}</span>
              {isActive && (
                <span className="ml-auto text-[10px] text-zinc-500 font-mono">{t("active").toLowerCase()}</span>
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
