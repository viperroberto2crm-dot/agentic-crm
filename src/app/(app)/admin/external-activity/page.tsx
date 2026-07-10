import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { redirect } from "next/navigation"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getTranslations } from "next-intl/server"
import { cn } from "@/lib/utils"
import {
  ExternalAppointmentsList,
  type ExternalAppointmentRow,
} from "./_components/external-appointments-list"
import {
  ExternalPaymentsList,
  type ExternalPaymentRow,
} from "./_components/external-payments-list"

type TypedClient = SupabaseClient<Database>

export const dynamic = "force-dynamic"

const UNASSIGNED_SLUG = "unassigned"

type ProviderFilter = "all" | "square" | "stripe"

type ApptDbRow = {
  id: string
  provider: string | null
  status: string | null
  service: string | null
  staff: string | null
  starts_at: string | null
  ends_at: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  lead_id: string | null
  brand_id: string | null
  created_at: string
}

type PaymentDbRow = {
  id: string
  provider: string | null
  amount_cents: number
  currency: string | null
  status: string | null
  items: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  reference: string | null
  paid_at: string | null
  lead_id: string | null
  brand_id: string | null
  created_at: string
}

/**
 * Página admin de SOLO LECTURA: TODAS las citas (Square) y pagos (Square +
 * Stripe) en un solo lugar — vinculados o no. Complementa /admin/external-unlinked
 * (que muestra solo los lead_id NULL para vincularlos). Aquí NO se edita nada.
 * SOLO admin: la lista tiene PII (nombre/tel/email) de TODAS las clínicas, así
 * que un manager (de una sola clínica) no debe verla — evita fuga cross-brand.
 *
 * Join brands/leads: se resuelve con fetches aparte + Maps en el server (no
 * embed PostgREST) para mantener el tipado limpio y evitar ambigüedad de relación.
 */
export default async function ExternalActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const { data: profile } = await sb
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single()
  const role = (profile?.role ?? "rep") as string
  if (role !== "admin") redirect("/")

  const { provider: providerParam } = await searchParams
  const provider: ProviderFilter =
    providerParam === "square" || providerParam === "stripe"
      ? providerParam
      : "all"

  const t = await getTranslations("externalActivity")

  const admin = createAdminClient() as unknown as TypedClient

  const apptsQuery = admin
    .from("external_appointments")
    .select(
      "id, provider, status, service, staff, starts_at, ends_at, customer_name, customer_email, customer_phone, lead_id, brand_id, created_at",
    )
    .order("starts_at", { ascending: false, nullsFirst: false })
    .limit(300)

  const paymentsQuery = admin
    .from("external_payments")
    .select(
      "id, provider, amount_cents, currency, status, items, customer_name, customer_email, customer_phone, reference, paid_at, lead_id, brand_id, created_at",
    )
    .order("paid_at", { ascending: false, nullsFirst: false })
    .limit(300)

  // Citas solo existen en Square. Si el filtro es Stripe, no traemos citas.
  const [apptsRes, paymentsRes] = await Promise.all([
    provider === "all" || provider === "square"
      ? (provider === "square"
          ? apptsQuery.eq("provider", "square")
          : apptsQuery)
      : Promise.resolve({ data: [], error: null }),
    provider === "all"
      ? paymentsQuery
      : paymentsQuery.eq("provider", provider),
  ])

  if (apptsRes.error) {
    console.error("[external-activity] appointments:", apptsRes.error.message)
  }
  if (paymentsRes.error) {
    console.error("[external-activity] payments:", paymentsRes.error.message)
  }

  const apptRows = (apptsRes.data ?? []) as ApptDbRow[]
  const paymentRows = (paymentsRes.data ?? []) as PaymentDbRow[]

  // ── Resolver brand_id → etiqueta y lead_id → nombre (Maps en el server) ──
  const brandIds = new Set<string>()
  const leadIds = new Set<string>()
  for (const r of apptRows) {
    if (r.brand_id) brandIds.add(r.brand_id)
    if (r.lead_id) leadIds.add(r.lead_id)
  }
  for (const r of paymentRows) {
    if (r.brand_id) brandIds.add(r.brand_id)
    if (r.lead_id) leadIds.add(r.lead_id)
  }

  // Nombres legibles de servicio: el ID crudo (service_variation_id) → offer_label
  // del mapa de ofertas, si está mapeado. Si no, el UI muestra "Cita agendada".
  const serviceIds = new Set<string>()
  for (const r of apptRows) if (r.service) serviceIds.add(r.service)

  const [brandsRes, leadsRes, offersRes] = await Promise.all([
    admin.from("brands").select("id, name, slug"),
    leadIds.size > 0
      ? admin
          .from("leads")
          .select("id, first_name, last_name")
          .in("id", Array.from(leadIds))
      : Promise.resolve({ data: [], error: null }),
    serviceIds.size > 0
      ? admin
          .from("offer_brand_map")
          .select("offer_key, offer_label")
          .in("offer_key", Array.from(serviceIds))
      : Promise.resolve({ data: [], error: null }),
  ])

  const serviceMap = new Map<string, string>()
  for (const o of (offersRes.data ?? []) as Array<{ offer_key: string; offer_label: string | null }>) {
    if (o.offer_label) serviceMap.set(o.offer_key, o.offer_label)
  }

  if (brandsRes.error) {
    console.error("[external-activity] brands:", brandsRes.error.message)
  }
  if (leadsRes.error) {
    console.error("[external-activity] leads:", leadsRes.error.message)
  }

  const brandMap = new Map<string, { name: string; slug: string }>()
  for (const b of (brandsRes.data ?? []) as Array<{
    id: string
    name: string
    slug: string
  }>) {
    brandMap.set(b.id, { name: b.name, slug: b.slug })
  }

  const leadMap = new Map<string, string>()
  for (const l of (leadsRes.data ?? []) as Array<{
    id: string
    first_name: string
    last_name: string | null
  }>) {
    leadMap.set(l.id, `${l.first_name} ${l.last_name ?? ""}`.trim())
  }

  const brandLabel = (brandId: string | null): string => {
    if (!brandId) return "—"
    const b = brandMap.get(brandId)
    if (!b) return "—"
    if (b.slug === UNASSIGNED_SLUG) return t("unassigned")
    return b.name
  }

  const appointments: ExternalAppointmentRow[] = apptRows.map((r) => ({
    id: r.id,
    provider: r.provider,
    status: r.status,
    service: r.service,
    serviceLabel: r.service ? serviceMap.get(r.service) ?? "Cita agendada" : "Cita agendada",
    staff: r.staff,
    starts_at: r.starts_at,
    customer_name: r.customer_name,
    customer_email: r.customer_email,
    customer_phone: r.customer_phone,
    lead_id: r.lead_id,
    created_at: r.created_at,
    brandLabel: brandLabel(r.brand_id),
    leadName: r.lead_id ? leadMap.get(r.lead_id) ?? null : null,
  }))

  const payments: ExternalPaymentRow[] = paymentRows.map((r) => ({
    id: r.id,
    provider: r.provider,
    amount_cents: r.amount_cents,
    currency: r.currency,
    status: r.status,
    items: r.items,
    customer_name: r.customer_name,
    customer_email: r.customer_email,
    customer_phone: r.customer_phone,
    reference: r.reference,
    paid_at: r.paid_at,
    lead_id: r.lead_id,
    created_at: r.created_at,
    brandLabel: brandLabel(r.brand_id),
    leadName: r.lead_id ? leadMap.get(r.lead_id) ?? null : null,
  }))

  const pills: Array<{ key: ProviderFilter; label: string }> = [
    { key: "all", label: t("filterAll") },
    { key: "square", label: t("filterSquare") },
    { key: "stripe", label: t("filterStripe") },
  ]

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-[#20342C]">{t("title")}</h1>
        <p className="text-[13px] text-[#93A39D] mt-1">{t("subtitle")}</p>
      </div>

      <div className="flex items-center gap-1.5">
        {pills.map((pill) => {
          const active = provider === pill.key
          const href =
            pill.key === "all"
              ? "/admin/external-activity"
              : `/admin/external-activity?provider=${pill.key}`
          return (
            <Link
              key={pill.key}
              href={href}
              className={cn(
                "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-transparent text-muted-foreground border-border hover:bg-secondary/40",
              )}
            >
              {pill.label}
            </Link>
          )
        })}
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-[10px] bg-[#E4F2EE] flex items-center justify-center shrink-0">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#2E8B6F" strokeWidth="2"><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4" strokeLinecap="round"/></svg>
          </span>
          <h2 className="font-display text-lg font-semibold tracking-tight text-[#20342C]">
            {t("appointmentsHeading", { count: appointments.length })}
          </h2>
        </div>
        <ExternalAppointmentsList appointments={appointments} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-[10px] bg-[#E6F3EC] flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2E7E5B" strokeWidth="2"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18" strokeLinecap="round"/></svg>
          </span>
          <h2 className="font-display text-lg font-semibold tracking-tight text-[#20342C]">
            {t("paymentsHeading", { count: payments.length })}
          </h2>
        </div>
        <ExternalPaymentsList payments={payments} />
      </section>
    </div>
  )
}
