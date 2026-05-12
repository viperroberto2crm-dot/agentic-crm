"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { useRouter } from "next/navigation"

export type Brand = {
  id: string
  slug: string
  name: string
  brand_color: string | null
}

type BrandContextValue = {
  activeBrand: Brand | null
  brands: Brand[]
  setActiveBrand: (brand: Brand) => void
}

const BrandContext = createContext<BrandContextValue | null>(null)

const FALLBACK_COLORS: Record<string, string> = {
  "si-se-pierde": "#E11D48",
  "sunny-slim": "#F59E0B",
}

function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

function applyBrandColor(brand: Brand) {
  const hex =
    brand.brand_color ?? FALLBACK_COLORS[brand.slug] ?? "#3B82F6"
  const hsl = hexToHsl(hex)
  const root = document.documentElement
  root.style.setProperty("--accent", hsl)
  root.style.setProperty("--accent-foreground", "0 0% 100%")
  root.style.setProperty("--ring", hsl)
  root.style.setProperty("--brand", hex)
  root.style.setProperty("--brand-hsl", hsl)
}

function setSlugCookie(slug: string) {
  document.cookie = `crm_brand_slug=${slug}; path=/; max-age=31536000; SameSite=Lax`
}

export function BrandProvider({
  brands,
  children,
}: {
  brands: Brand[]
  children: React.ReactNode
}) {
  const [activeBrand, setActiveBrandState] = useState<Brand | null>(null)
  const router = useRouter()

  useEffect(() => {
    if (!brands.length) return
    const storedId = localStorage.getItem("activeBrandId")
    const found = brands.find((b) => b.id === storedId) ?? brands[0]
    setActiveBrandState(found)
    applyBrandColor(found)
    setSlugCookie(found.slug)
  }, [brands])

  const setActiveBrand = useCallback((brand: Brand) => {
    setActiveBrandState(brand)
    localStorage.setItem("activeBrandId", brand.id)
    applyBrandColor(brand)
    setSlugCookie(brand.slug)
    router.refresh()
  }, [router])

  return (
    <BrandContext.Provider value={{ activeBrand, brands, setActiveBrand }}>
      {children}
    </BrandContext.Provider>
  )
}

export function useBrand() {
  const ctx = useContext(BrandContext)
  if (!ctx) throw new Error("useBrand must be used within BrandProvider")
  return ctx
}
