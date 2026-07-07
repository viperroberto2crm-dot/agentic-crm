"use client"

import { useTranslations } from "next-intl"
import { ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { Brand } from "@/context/brand-context"

const BRAND_COLORS: Record<string, string> = {
  "si-se-pierde": "#E11D48",
  "sunny-slim": "#F59E0B",
}

function brandColor(brand: Brand): string {
  return brand.brand_color ?? BRAND_COLORS[brand.slug] ?? "#3B82F6"
}

// Small multicolor mark for "all companies" — up to three dots using the
// first three brands' colors so no single brand color dominates.
function AllCompaniesIcon({ brands }: { brands: Brand[] }) {
  const colors = brands.slice(0, 3).map(brandColor)
  return (
    <span className="flex items-center gap-0.5 shrink-0" aria-hidden="true">
      {colors.map((color, i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  )
}

type BrandSelectorProps = {
  brands: Brand[]
  activeBrand: Brand | null
  onSelect: (brand: Brand) => void
  isAllActive: boolean
  onSelectAll: () => void
}

export function BrandSelector({
  brands,
  activeBrand,
  onSelect,
  isAllActive,
  onSelectAll,
}: BrandSelectorProps) {
  const t = useTranslations("common")
  if (!activeBrand && !isAllActive) return null

  const showAll = brands.length >= 2
  const activeColor = activeBrand ? brandColor(activeBrand) : "#3B82F6"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-foreground hover:text-[#0A4538] hover:bg-secondary transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]">
          {isAllActive ? (
            <AllCompaniesIcon brands={brands} />
          ) : (
            <span
              className="w-2 h-2 rounded-full shrink-0 transition-colors duration-300"
              style={{ backgroundColor: activeColor }}
            />
          )}
          <span className="font-medium max-w-[160px] truncate">
            {isAllActive ? t("allCompanies") : activeBrand?.name}
          </span>
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52 bg-popover border-border shadow-lg shadow-[#1A2E28]/10"
      >
        {showAll && (
          <>
            <DropdownMenuItem
              onClick={onSelectAll}
              className={cn(
                "flex items-center gap-2.5 cursor-pointer text-sm",
                isAllActive
                  ? "text-[#0A4538] bg-secondary"
                  : "text-foreground focus:text-[#0A4538]"
              )}
            >
              <AllCompaniesIcon brands={brands} />
              <span className="truncate">{t("allCompanies")}</span>
              {isAllActive && (
                <span className="ml-auto text-[10px] text-muted-foreground font-mono">{t("active").toLowerCase()}</span>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {brands.map((brand) => {
          const color = brand.brand_color ?? BRAND_COLORS[brand.slug] ?? "#3B82F6"
          const isActive = !isAllActive && brand.id === activeBrand?.id
          return (
            <DropdownMenuItem
              key={brand.id}
              onClick={() => onSelect(brand)}
              className={cn(
                "flex items-center gap-2.5 cursor-pointer text-sm",
                isActive
                  ? "text-[#0A4538] bg-secondary"
                  : "text-foreground focus:text-[#0A4538]"
              )}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="truncate">{brand.name}</span>
              {isActive && (
                <span className="ml-auto text-[10px] text-muted-foreground font-mono">{t("active").toLowerCase()}</span>
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
