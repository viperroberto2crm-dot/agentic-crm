"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Search, UserPlus } from "lucide-react"
import { Field, inputCls } from "@/app/(app)/settings/_components/form-primitives"
import {
  searchLeadsForLink,
  linkExternalPaymentToLead,
  linkExternalAppointmentToLead,
  createLeadFromExternalPayment,
  createLeadFromExternalAppointment,
  type LeadSearchResult,
} from "../_actions/external-unlinked-actions"

export type BrandOption = { id: string; name: string }

export type UnlinkedRecordKind = "payment" | "appointment"

export type LinkDialogPrefill = {
  name: string | null
  email: string | null
  phone: string | null
  address: string | null
}

type Props = {
  kind: UnlinkedRecordKind
  recordId: string
  prefill: LinkDialogPrefill
  brands: BrandOption[]
  defaultBrandId?: string | null
  initialTab?: Tab
  open: boolean
  onClose: () => void
}

type Tab = "search" | "create"

/** Divide "Nombre Apellido" en first/last (heurística simple). */
function splitName(name: string | null): { first: string; last: string } {
  const n = (name ?? "").trim()
  if (!n) return { first: "", last: "" }
  const parts = n.split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: "" }
  return { first: parts[0], last: parts.slice(1).join(" ") }
}

export function LinkLeadDialog({
  kind,
  recordId,
  prefill,
  brands,
  defaultBrandId,
  initialTab = "search",
  open,
  onClose,
}: Props) {
  const router = useRouter()
  const t = useTranslations("externalUnlinked")
  const tc = useTranslations("common")

  const [tab, setTab] = useState<Tab>(initialTab)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modo (a) buscar
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<LeadSearchResult[]>([])

  // Modo (b) crear
  const initialName = splitName(prefill.name)
  const [brandId, setBrandId] = useState<string>(
    defaultBrandId ?? brands[0]?.id ?? "",
  )
  const [firstName, setFirstName] = useState(initialName.first)
  const [lastName, setLastName] = useState(initialName.last)
  const [phone, setPhone] = useState(prefill.phone ?? "")
  const [email, setEmail] = useState(prefill.email ?? "")
  const [address, setAddress] = useState(prefill.address ?? "")

  useEffect(() => {
    if (open) {
      setTab(initialTab)
      setError(null)
      setQuery("")
      setResults([])
      const nm = splitName(prefill.name)
      setBrandId(defaultBrandId ?? brands[0]?.id ?? "")
      setFirstName(nm.first)
      setLastName(nm.last)
      setPhone(prefill.phone ?? "")
      setEmail(prefill.email ?? "")
      setAddress(prefill.address ?? "")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function handleSearch() {
    setSearching(true)
    setError(null)
    try {
      const res = await searchLeadsForLink(query)
      if (!res.ok) {
        setError(res.error)
        setResults([])
        return
      }
      setResults(res.leads)
    } finally {
      setSearching(false)
    }
  }

  async function handleLink(leadId: string) {
    setLoading(true)
    setError(null)
    try {
      const res =
        kind === "payment"
          ? await linkExternalPaymentToLead(recordId, leadId)
          : await linkExternalAppointmentToLead(recordId, leadId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.refresh()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"))
    } finally {
      setLoading(false)
    }
  }

  const canCreate = !!brandId && firstName.trim().length > 0

  async function handleCreate() {
    if (!canCreate) return
    setLoading(true)
    setError(null)
    try {
      const input = {
        brand_id: brandId,
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
      }
      const res =
        kind === "payment"
          ? await createLeadFromExternalPayment(recordId, input)
          : await createLeadFromExternalAppointment(recordId, input)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.refresh()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="light-surface max-w-md bg-white border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">{t("linkTitle")}</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          <button
            type="button"
            onClick={() => setTab("search")}
            className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === "search"
                ? "border-current text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("tabSearch")}
          </button>
          <button
            type="button"
            onClick={() => setTab("create")}
            className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === "create"
                ? "border-current text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("tabCreate")}
          </button>
        </div>

        {tab === "search" ? (
          <div className="space-y-3 pt-2">
            <div className="flex gap-2">
              <Input
                className={inputCls}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch()
                }}
                placeholder={t("searchPlaceholder")}
                autoFocus
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={handleSearch}
                disabled={searching || query.trim().length < 2}
                className="gap-1.5 shrink-0"
              >
                <Search className="w-3.5 h-3.5" />
                {searching ? tc("loading") : tc("search")}
              </Button>
            </div>

            {results.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                {t("searchHint")}
              </p>
            ) : (
              <div className="rounded-lg border border-border divide-y divide-border max-h-64 overflow-y-auto">
                {results.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => handleLink(lead.id)}
                    disabled={loading}
                    className="w-full text-left px-3 py-2 hover:bg-secondary/40 transition-colors flex items-center justify-between gap-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground truncate">
                        {lead.first_name} {lead.last_name ?? ""}
                      </span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {lead.phone || lead.email || "—"}
                        {lead.brand_name ? ` · ${lead.brand_name}` : ""}
                      </span>
                    </span>
                    <span className="text-xs text-primary shrink-0">
                      {t("linkBtn")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            <Field label={t("brand")} required>
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger className={inputCls}>
                  <SelectValue placeholder={t("brandPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("firstName")} required>
                <Input
                  className={inputCls}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </Field>
              <Field label={t("lastName")}>
                <Input
                  className={inputCls}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </Field>
            </div>

            <Field label={t("phone")}>
              <Input
                className={inputCls}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>

            <Field label={t("email")}>
              <Input
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <Field label={t("address")}>
              <Input
                className={inputCls}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>
          </div>
        )}

        {error && <p className="text-xs text-red-500 pt-1">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {tc("cancel")}
          </Button>
          {tab === "create" && (
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={loading || !canCreate}
              className="gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {loading ? tc("creating") : t("createLeadBtn")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
