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
  isAllCompanies: boolean
  setAllCompanies: () => void
}

const BrandContext = createContext<BrandContextValue | null>(null)

export const ALL_COMPANIES = "__all__"

// Neutral accent used in "all companies" mode so no single brand color
// dominates the chrome. HORIZON green.
const NEUTRAL_BRAND_HEX = "#0E5F4C"

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

function applyNeutralColor() {
  const hex = NEUTRAL_BRAND_HEX
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
  const [isAllCompanies, setIsAllCompanies] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (!brands.length) return
    const storedId = localStorage.getItem("activeBrandId")
    // "All companies" is only valid when the user has 2+ brands.
    if (storedId === ALL_COMPANIES && brands.length >= 2) {
      setActiveBrandState(null)
      setIsAllCompanies(true)
      applyNeutralColor()
      setSlugCookie(ALL_COMPANIES)
      return
    }
    const found = brands.find((b) => b.id === storedId) ?? brands[0]
    setActiveBrandState(found)
    setIsAllCompanies(false)
    applyBrandColor(found)
    setSlugCookie(found.slug)
  }, [brands])

  const setActiveBrand = useCallback((brand: Brand) => {
    setActiveBrandState(brand)
    setIsAllCompanies(false)
    localStorage.setItem("activeBrandId", brand.id)
    applyBrandColor(brand)
    setSlugCookie(brand.slug)
    router.refresh()
  }, [router])

  const setAllCompanies = useCallback(() => {
    setActiveBrandState(null)
    setIsAllCompanies(true)
    localStorage.setItem("activeBrandId", ALL_COMPANIES)
    applyNeutralColor()
    setSlugCookie(ALL_COMPANIES)
    router.refresh()
  }, [router])

  return (
    <BrandContext.Provider
      value={{ activeBrand, brands, setActiveBrand, isAllCompanies, setAllCompanies }}
    >
      {children}
    </BrandContext.Provider>
  )
}

export function useBrand() {
  const ctx = useContext(BrandContext)
  if (!ctx) throw new Error("useBrand must be used within BrandProvider")
  return ctx
}
