"use client"

import { useRouter } from "next/navigation"
import { useTransition, useState, useEffect } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createLead } from "../actions"
import { fetchProducts } from "../[id]/actions"
import { useBrand } from "@/context/brand-context"

type ProductOption = { id: string; name: string; price_cents: number; cadence: string }

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

export default function NewLeadPage() {
  const t = useTranslations("leads")
  const tsrc = useTranslations("source")
  const ts = useTranslations("sales")
  const tc = useTranslations("common")
  const router = useRouter()
  const { activeBrand } = useBrand()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<string>("")
  const [products, setProducts] = useState<ProductOption[]>([])
  const [productInterest, setProductInterest] = useState<string>("")

  const SOURCE_OPTIONS = [
    { value: "inbound_call", label: tsrc("inbound_call") },
    { value: "web_form", label: tsrc("web_form") },
    { value: "referral", label: tsrc("referral") },
    { value: "whatsapp", label: tsrc("whatsapp") },
    { value: "walk_in", label: tsrc("walk_in") },
    { value: "social", label: tsrc("social") },
    { value: "other", label: tsrc("other") },
  ]

  const CADENCE_LABELS: Record<string, string> = {
    weekly: ts("subs.cadenceWeekly"),
    biweekly: ts("subs.cadenceBiweekly"),
    monthly: ts("subs.cadenceMonthly"),
    quarterly: ts("subs.cadenceQuarterly"),
    annual: ts("subs.cadenceAnnual"),
    one_time: "—",
  }

  function fmtProduct(p: ProductOption) {
    const price = (p.price_cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    const cadence = CADENCE_LABELS[p.cadence] ?? p.cadence
    return `${p.name} — ${price}/${cadence}`
  }

  useEffect(() => {
    if (!activeBrand?.id) { setProducts([]); return }
    fetchProducts(activeBrand.id)
      .then((data) => setProducts(data as ProductOption[]))
      .catch(() => setProducts([]))
  }, [activeBrand?.id])

  function handleSubmit(formData: FormData) {
    if (!activeBrand) {
      setError(t("selectBrandFirst"))
      return
    }
    formData.set("brand_id", activeBrand.id)
    if (source) formData.set("source", source)

    if (productInterest) {
      const selected = products.find((p) => p.id === productInterest)
      if (selected) {
        const existing = (formData.get("notes") as string | null)?.trim() ?? ""
        const productLine = `${t("productInterest")}: ${fmtProduct(selected)}`
        formData.set("notes", existing ? `${productLine}\n\n${existing}` : productLine)
      }
    }

    setError(null)
    startTransition(async () => {
      try {
        const id = await createLead(formData)
        router.push(`/leads/${id}?created=1`)
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("savingError"))
      }
    })
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">

      <div className="flex items-center gap-2">
        <Link
          href="/leads"
          className="text-muted-foreground hover:text-muted-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-lg font-semibold text-foreground">{t("newLeadTitle")}</h1>
      </div>

      {activeBrand && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: activeBrand.brand_color ?? "#3B82F6" }}
          />
          {activeBrand.name}
        </div>
      )}

      <form action={handleSubmit} className="space-y-4">

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("firstName")} required>
            <Input
              name="first_name"
              required
              placeholder="John"
              className="bg-white border-border text-foreground placeholder:text-muted-foreground"
            />
          </Field>
          <Field label={t("lastName")}>
            <Input
              name="last_name"
              placeholder="Smith"
              className="bg-white border-border text-foreground placeholder:text-muted-foreground"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("phone")} required>
            <Input
              name="phone"
              type="tel"
              required
              placeholder="+1 555 123 4567"
              className="bg-white border-border text-foreground placeholder:text-muted-foreground font-mono"
            />
          </Field>
          <Field label={t("email")}>
            <Input
              name="email"
              type="email"
              placeholder="john@mail.com"
              className="bg-white border-border text-foreground placeholder:text-muted-foreground"
            />
          </Field>
        </div>

        <Field label={t("source")}>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="bg-white border-border text-foreground">
              <SelectValue placeholder={t("selectSource")} />
            </SelectTrigger>
            <SelectContent className="bg-white border-border">
              {SOURCE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-foreground">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {products.length > 0 && (
          <Field label={t("productInterest")}>
            <Select value={productInterest} onValueChange={setProductInterest}>
              <SelectTrigger className="bg-white border-border text-foreground">
                <SelectValue placeholder={t("selectProduct")} />
              </SelectTrigger>
              <SelectContent className="bg-white border-border">
                <SelectItem value="none" className="text-muted-foreground">{t("noProduct")}</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-foreground">
                    {fmtProduct(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field label={t("notes")}>
          <textarea
            name="notes"
            rows={3}
            placeholder={t("notesPlaceholder")}
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 resize-none"
          />
        </Field>

        {error && (
          <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Button
            type="submit"
            disabled={isPending || !activeBrand}
            className="cursor-pointer"
            style={{ background: "var(--brand)" }}
          >
            {isPending ? t("saving") : t("createLead")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => router.back()}
          >
            {tc("cancel")}
          </Button>
        </div>

        {!activeBrand && (
          <p className="text-xs text-muted-foreground">
            {t("selectBrandHint")}
          </p>
        )}
      </form>
    </div>
  )
}
