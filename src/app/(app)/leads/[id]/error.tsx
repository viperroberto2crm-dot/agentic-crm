"use client"

// Error boundary de la ficha del lead. Si CUALQUIER componente de esta página
// lanza al renderizar, en vez de tumbar toda la app con un 500 crudo, se muestra
// este fallback amable con opción de reintentar. Defensa en profundidad: el
// contenido de la página ya es robusto (fechas/monedas blindadas), esto es la
// última red por si aparece un dato inesperado.

import { useEffect } from "react"
import Link from "next/link"
import { AlertTriangle, RotateCcw, ArrowLeft } from "lucide-react"

export default function LeadError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[leads/[id]] render error:", error)
  }, [error])

  return (
    <div className="p-6 max-w-md mx-auto">
      <div className="bg-white border border-border/60 rounded-2xl p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-[#FF6B5E]/10 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-7 h-7 text-[#E07856]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[#1A2E28]">
            No se pudo cargar este lead
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Ocurrió un problema al mostrar la información. Intenta de nuevo.
          </p>
          {error.digest && (
            <p className="text-[11px] text-muted-foreground/70 mt-2 font-mono">
              Ref: {error.digest}
            </p>
          )}
        </div>
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#0E5F4C] text-white text-sm font-medium hover:bg-[#0A4538] transition-colors"
          >
            <RotateCcw className="w-4 h-4" /> Reintentar
          </button>
          <Link
            href="/leads"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-[#E8E4DC] text-sm text-[#5C6F68] hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Volver a Leads
          </Link>
        </div>
      </div>
    </div>
  )
}
