"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { Copy, Check, ExternalLink, CreditCard, Loader2 } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  listBrandStripeOffers, createChargeLink, type BrandOffer,
} from "../actions"

type Result = { url: string; qrDataUrl: string }

export function ChargeModal({
  open,
  onClose,
  leadId,
  brandId,
}: {
  open: boolean
  onClose: () => void
  leadId: string
  brandId: string
}) {
  const t = useTranslations("sales")
  const [offers, setOffers] = useState<BrandOffer[] | null>(null)
  const [offerKey, setOfferKey] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()
  const submittingRef = useRef(false)

  // Cargar ofertas de la marca al abrir.
  useEffect(() => {
    if (!open) return
    setOffers(null)
    setError(null)
    setResult(null)
    setOfferKey("")
    listBrandStripeOffers(brandId).then((r) => {
      if (r.ok) {
        setOffers(r.offers)
        if (r.offers.length === 1) setOfferKey(r.offers[0].offer_key)
      } else {
        setOffers([])
        setError(r.error)
      }
    })
  }, [open, brandId])

  function handleGenerate() {
    if (!offerKey || submittingRef.current) return
    submittingRef.current = true
    setError(null)
    startTransition(async () => {
      try {
        const r = await createChargeLink({ lead_id: leadId, brand_id: brandId, offer_key: offerKey })
        if (r.ok) setResult({ url: r.url, qrDataUrl: r.qrDataUrl })
        else setError(r.error)
      } finally {
        submittingRef.current = false
      }
    })
  }

  async function copyLink() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard no disponible */
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-gray-900">
            <CreditCard className="w-4 h-4" style={{ color: "var(--brand)" }} />
            {t("charge")}
          </DialogTitle>
        </DialogHeader>

        {/* Estado 1: elegir oferta y generar */}
        {!result && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">{t("chargeSubtitle")}</p>

            {offers === null ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}
              </div>
            ) : offers.length === 0 ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                {t("noOffersHint")}
              </p>
            ) : (
              <div className="space-y-1.5">
                <label htmlFor="offer" className="text-xs font-medium text-gray-600">
                  {t("pickOffer")}
                </label>
                <select
                  id="offer"
                  value={offerKey}
                  onChange={(e) => setOfferKey(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                >
                  <option value="" disabled>{t("pickOfferPlaceholder")}</option>
                  {offers.map((o) => (
                    <option key={o.offer_key} value={o.offer_key}>{o.offer_label}</option>
                  ))}
                </select>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            {offers !== null && offers.length > 0 && (
              <Button
                onClick={handleGenerate}
                disabled={!offerKey || pending}
                className="w-full gap-1.5 cursor-pointer"
                style={{ background: "var(--brand)" }}
              >
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                {pending ? t("generating") : t("generateLink")}
              </Button>
            )}
          </div>
        )}

        {/* Estado 2: link listo (copiar / QR / abrir) */}
        {result && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">{t("linkReady")}</p>

            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.qrDataUrl}
                alt="QR"
                width={200}
                height={200}
                className="rounded-md border border-gray-200"
              />
            </div>

            <p className="text-xs font-mono text-gray-500 break-all bg-gray-50 border border-gray-200 rounded-md p-2">
              {result.url}
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyLink}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                {copied
                  ? (<><Check className="w-3.5 h-3.5 text-emerald-600" /> {t("copied")}</>)
                  : (<><Copy className="w-3.5 h-3.5" /> {t("copyLink")}</>)}
              </button>
              <Link
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-md text-sm text-white transition-colors cursor-pointer"
                style={{ background: "var(--brand)" }}
              >
                <ExternalLink className="w-3.5 h-3.5" /> {t("openLink")}
              </Link>
            </div>

            <button
              type="button"
              onClick={() => { setResult(null); setOfferKey(offers?.length === 1 ? offers[0].offer_key : "") }}
              className="w-full text-xs text-gray-400 hover:text-gray-700 transition-colors cursor-pointer pt-1"
            >
              {t("newCharge")}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
