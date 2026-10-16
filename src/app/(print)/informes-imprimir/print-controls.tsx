"use client"

import { useEffect } from "react"

export function PrintControls({ auto }: { auto: boolean }) {
  useEffect(() => {
    if (!auto) return
    // Da un instante para que carguen las fuentes antes de abrir el diálogo.
    const t = setTimeout(() => window.print(), 600)
    return () => clearTimeout(t)
  }, [auto])

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded-xl bg-[#20342C] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
    >
      Imprimir / Guardar como PDF
    </button>
  )
}
