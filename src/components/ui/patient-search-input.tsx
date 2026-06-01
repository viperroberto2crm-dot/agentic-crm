"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { Search, X } from "lucide-react"

/**
 * Input de búsqueda por nombre/teléfono de paciente. Actualiza el query
 * param `?search=X` con debounce de 400ms. El page server lee ese param
 * y filtra las queries por leads.id IN (matching leads).
 *
 * Fix race condition: usamos `lastSetByUs` ref para distinguir cambios de
 * URL causados por nuestro router.replace (skip sync) vs cambios externos
 * (back/forward del browser → aplicar sync). Sin esto, el sync useEffect
 * pisaba lo que el usuario estaba escribiendo cuando llegaba el efecto del
 * router.replace anterior — el usuario tenía que escribir varias veces.
 */
export function PatientSearchInput({
  placeholder,
}: {
  placeholder?: string
}) {
  const tc = useTranslations("common")
  const effectivePlaceholder = placeholder ?? tc("searchPatientPlaceholder")
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initial = searchParams.get("search") ?? ""
  const [value, setValue] = useState(initial)
  const lastSetByUs = useRef(initial)

  // Sync con URL si cambia desde fuera (back/forward del browser).
  // Si fuimos NOSOTROS (router.replace después de debounce), skip.
  useEffect(() => {
    const urlValue = searchParams.get("search") ?? ""
    if (urlValue === lastSetByUs.current) return
    setValue(urlValue)
  }, [searchParams])

  // Debounce: 400ms después del último keystroke, sincroniza al URL.
  useEffect(() => {
    const handler = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      const trimmed = value.trim()
      lastSetByUs.current = trimmed
      if (trimmed) {
        params.set("search", trimmed)
      } else {
        params.delete("search")
      }
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    }, 400)
    return () => clearTimeout(handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <div className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={effectivePlaceholder}
        className="w-full h-9 pl-9 pr-9 text-sm bg-white border border-gray-200 rounded-md text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-zinc-700"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-300 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
          title={tc("clear")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
