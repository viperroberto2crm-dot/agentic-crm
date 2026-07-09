"use client"

import { useState } from "react"
import { Copy, Check, ExternalLink } from "lucide-react"

// Panel de solo lectura: lista los links públicos de intake por clínica (para
// tablet/kiosco) con botón de copiar y su código QR. QR generado en el server
// y pasado como data URI. Sin datos sensibles.

export type IntakeLinkItem = {
  slug: string
  name: string
  color: string
  url: string
  qrDataUrl: string
}

type Labels = {
  title: string
  subtitle: string
  copy: string
  copied: string
  open: string
}

function CopyButton({ url, labels }: { url: string; labels: Labels }) {
  const [done, setDone] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setDone(true)
      setTimeout(() => setDone(false), 1800)
    } catch {
      /* clipboard no disponible: ignorar */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[#E8E4DC] text-xs text-[#5C6F68] hover:text-[#0A4538] hover:bg-secondary transition-colors cursor-pointer"
    >
      {done ? (
        <>
          <Check className="w-3.5 h-3.5 text-[#2E8B6F]" /> {labels.copied}
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" /> {labels.copy}
        </>
      )}
    </button>
  )
}

export function IntakeLinksPanel({
  items,
  labels,
}: {
  items: IntakeLinkItem[]
  labels: Labels
}) {
  if (items.length === 0) return null
  return (
    <div className="bg-white border border-border/60 rounded-2xl p-5 md:p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-[#1A2E28] uppercase tracking-widest">
          {labels.title}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">{labels.subtitle}</p>
      </div>

      <div className="space-y-3">
        {items.map((it) => (
          <div
            key={it.slug}
            className="flex items-center gap-4 border border-[#F2EFE9] rounded-xl p-3"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={it.qrDataUrl}
              alt={`QR ${it.name}`}
              width={88}
              height={88}
              className="shrink-0 rounded-md border border-[#F2EFE9]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: it.color }}
                />
                <span className="font-medium text-[#1A2E28] truncate">{it.name}</span>
              </div>
              <p className="text-xs text-muted-foreground font-mono truncate mt-1">{it.url}</p>
              <div className="flex items-center gap-2 mt-2">
                <CopyButton url={it.url} labels={labels} />
                <a
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[#E8E4DC] text-xs text-[#5C6F68] hover:text-[#0A4538] hover:bg-secondary transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> {labels.open}
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
