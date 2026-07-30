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
  listBrandOffers, createChargeLink, createCustomChargeLink, type BrandOffer,
} from "../actions"

// value del <select> = "provider:offer_key" para no cruzar keys entre proveedores.
const offerValue = (o: BrandOffer) => `${o.provider}:${o.offer_key}`
const providerLabel = (p: BrandOffer["provider"]) => (p === "square" ? "Square" : "Stripe")

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

  // Modo del cobro: "offer" (oferta mapeada) o "custom" (monto libre).
  const [mode, setMode] = useState<"offer" | "custom">("offer")
  const [customDesc, setCustomDesc] = useState("")
  const [customAmount, setCustomAmount] = useState("")
  const [customProvider, setCustomProvider] = useState<"stripe" | "square">("stripe")

  // Cargar ofertas de la marca al abrir.
  useEffect(() => {
    if (!open) return
    setOffers(null)
    setError(null)
    setResult(null)
    setOfferKey("")
    setMode("offer")
    setCustomDesc("")
    setCustomAmount("")
    setCustomProvider("stripe")
    listBrandOffers(brandId).then((r) => {
      if (r.ok) {
        setOffers(r.offers)
        if (r.offers.length === 1) setOfferKey(offerValue(r.offers[0]))
      } else {
        setOffers([])
        setError(r.error)
      }
    })
  }, [open, brandId])

  // Dólares tecleados → centavos enteros. null si es inválido. Exigimos UN solo
  // separador y máx 2 decimales: así "1,000"/"1.000,50" (miles) se rechazan en
  // vez de convertirse en $1.00 (Fable: bug de sub-cobro 1000x).
  const amountCents = (() => {
    const raw = customAmount.trim()
    if (!/^\d+([.,]\d{1,2})?$/.test(raw)) return null
    const n = Math.round(parseFloat(raw.replace(",", ".")) * 100)
    return Number.isFinite(n) && n >= 100 ? n : null
  })()
  const amountPreview =
    amountCents !== null
      ? `$${(amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null

  function run(fn: () => Promise<{ ok: true; url: string; qrDataUrl: string } | { ok: false; error: string }>) {
    if (submittingRef.current) return
    submittingRef.current = true
    setError(null)
    startTransition(async () => {
      try {
        const r = await fn()
        if (r.ok) setResult({ url: r.url, qrDataUrl: r.qrDataUrl })
        else setError(r.error)
      } finally {
        submittingRef.current = false
      }
    })
  }

  function handleGenerate() {
    const selected = offers?.find((o) => offerValue(o) === offerKey)
    if (!selected) return
    run(() => createChargeLink({
      lead_id: leadId,
      brand_id: brandId,
      offer_key: selected.offer_key,
      provider: selected.provider,
    }))
  }

  function handleGenerateCustom() {
    if (!customDesc.trim() || amountCents === null) return
    run(() => createCustomChargeLink({
      lead_id: leadId,
      brand_id: brandId,
      provider: customProvider,
      amount_cents: amountCents,
      description: customDesc.trim(),
    }))
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

        {/* Estado 1: elegir oferta o monto personalizado y generar */}
        {!result && (
          <div className="space-y-4">
            {/* Pestañas: oferta vs monto personalizado */}
            <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg text-sm">
              {(["offer", "custom"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError(null) }}
                  className={`flex-1 h-8 rounded-md transition-colors cursor-pointer ${
                    mode === m ? "bg-white text-gray-900 shadow-sm font-medium" : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {m === "offer" ? t("offerTab") : t("customTab")}
                </button>
              ))}
            </div>

            {mode === "offer" ? (
              <>
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
                        <option key={offerValue(o)} value={offerValue(o)}>
                          {o.offer_label} · {providerLabel(o.provider)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500">{t("customSubtitle")}</p>
                <div className="space-y-1.5">
                  <label htmlFor="cdesc" className="text-xs font-medium text-gray-600">{t("conceptLabel")}</label>
                  <input
                    id="cdesc"
                    type="text"
                    maxLength={120}
                    value={customDesc}
                    onChange={(e) => setCustomDesc(e.target.value)}
                    placeholder={t("conceptPlaceholder")}
                    className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="camount" className="text-xs font-medium text-gray-600">{t("amountLabel")}</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      id="camount"
                      type="text"
                      inputMode="decimal"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full h-10 pl-6 pr-3 rounded-md border border-gray-300 bg-white text-sm text-gray-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                    />
                  </div>
                  {customAmount.trim() && (
                    amountPreview ? (
                      <p className="text-xs text-emerald-700 tabular-nums">{t("willCharge")}: {amountPreview}</p>
                    ) : (
                      <p className="text-xs text-red-600">{t("invalidAmount")}</p>
                    )
                  )}
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-600">{t("providerLabel")}</span>
                  <div className="flex gap-2">
                    {(["stripe", "square"] as const).map((pv) => (
                      <button
                        key={pv}
                        type="button"
                        onClick={() => setCustomProvider(pv)}
                        className={`flex-1 h-9 rounded-md border text-sm transition-colors cursor-pointer ${
                          customProvider === pv
                            ? "border-gray-900 text-gray-900 font-medium bg-gray-50"
                            : "border-gray-300 text-gray-500 hover:text-gray-800"
                        }`}
                      >
                        {pv === "stripe" ? "Stripe" : "Square"}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            {mode === "offer"
              ? offers !== null && offers.length > 0 && (
                  <Button
                    onClick={handleGenerate}
                    disabled={!offerKey || pending}
                    className="w-full gap-1.5 cursor-pointer"
                    style={{ background: "var(--brand)" }}
                  >
                    {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                    {pending ? t("generating") : t("generateLink")}
                  </Button>
                )
              : (
                  <Button
                    onClick={handleGenerateCustom}
                    disabled={!customDesc.trim() || amountCents === null || pending}
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
              onClick={() => { setResult(null); setOfferKey(offers?.length === 1 ? offerValue(offers[0]) : "") }}
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
