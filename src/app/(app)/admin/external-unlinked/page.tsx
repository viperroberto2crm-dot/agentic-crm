import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { redirect } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getTranslations } from "next-intl/server"
import {
  UnlinkedPaymentsTable,
  type UnlinkedPaymentRow,
} from "./_components/unlinked-payments-table"
import {
  UnlinkedAppointmentsTable,
  type UnlinkedAppointmentRow,
} from "./_components/unlinked-appointments-table"
import type { BrandOption } from "./_components/link-lead-dialog"
import { ImportSquareBookingsButton } from "./_components/import-square-bookings-button"
import { ImportSquarePaymentsButton } from "./_components/import-square-payments-button"
import { PbSessionQueue, type PbSessionQueueRow } from "./_components/pb-session-queue"
import {
  UnassignedLeadsTable,
} from "./_components/unassigned-leads-table"
import type { UnassignedLead } from "./_actions/external-unlinked-actions"
import { getUnassignedBrandId } from "@/lib/integrations/offer-brand-map"

type TypedClient = SupabaseClient<Database>

export const dynamic = "force-dynamic"

/**
 * Página admin: pagos y citas externas (Square/Stripe) que llegaron por webhook
 * SIN vincular a ningún lead (lead_id IS NULL). Permite vincularlos a un lead
 * existente o crear uno nuevo. SOLO admin: la lista tiene PII (nombre/tel/email)
 * de pagos/citas de TODAS las clínicas sin marca resuelta, así que un manager
 * (de una sola clínica) no debe verla — evita fuga de datos entre clínicas.
 */
export default async function ExternalUnlinkedPage() {
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

  const t = await getTranslations("externalUnlinked")

  const admin = createAdminClient() as unknown as TypedClient

  const [paymentsRes, apptsRes, brandsRes] = await Promise.all([
    admin
      .from("external_payments")
      .select(
        "id, provider, amount_cents, currency, status, items, customer_name, customer_email, customer_phone, customer_address, paid_at, created_at",
      )
      .is("lead_id", null)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("external_appointments")
      .select(
        "id, provider, status, service, staff, starts_at, customer_name, customer_email, customer_phone, customer_address, created_at",
      )
      .is("lead_id", null)
      .order("starts_at", { ascending: false, nullsFirst: false })
      .limit(200),
    admin
      .from("brands")
      .select("id, name")
      .eq("active", true)
      .order("name"),
  ])

  if (paymentsRes.error) {
    console.error("[external-unlinked] payments:", paymentsRes.error.message)
  }
  if (apptsRes.error) {
    console.error("[external-unlinked] appointments:", apptsRes.error.message)
  }
  if (brandsRes.error) {
    console.error("[external-unlinked] brands:", brandsRes.error.message)
  }

  const payments = (paymentsRes.data ?? []) as UnlinkedPaymentRow[]
  const appointments = (apptsRes.data ?? []) as UnlinkedAppointmentRow[]
  const brands = (brandsRes.data ?? []) as BrandOption[]
  const defaultBrandId = brands[0]?.id ?? null

  // Cola de sesiones de PB que no se pudieron empujar (unmapped/failed). Columnas
  // nuevas (Fase 3) no están en los tipos generados → cast admin as any.
  let pbSessionQueue: PbSessionQueueRow[] = []
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: qData } = await (admin as any)
      .from("external_appointments")
      .select("id, customer_name, service, service_name, starts_at, pb_session_status, pb_error")
      .in("pb_session_status", ["unmapped", "failed"])
      .order("starts_at", { ascending: false, nullsFirst: false })
      .limit(100)
    pbSessionQueue = (qData ?? []) as PbSessionQueueRow[]
  }

  // Leads que quedaron en la marca centinela 'unassigned' (bug #3). El dropdown
  // de reasignación usa `brands` (active=true), que ya excluye a 'unassigned'.
  const unassignedBrandId = await getUnassignedBrandId(admin)
  let unassignedLeads: UnassignedLead[] = []
  if (unassignedBrandId) {
    const { data: ulRes, error: ulErr } = await admin
      .from("leads")
      .select("id, first_name, last_name, email, phone, source, notes, created_at")
      .eq("brand_id", unassignedBrandId)
      .order("created_at", { ascending: false })
      .limit(200)
    if (ulErr) console.error("[external-unlinked] unassigned leads:", ulErr.message)
    unassignedLeads = (ulRes ?? []) as UnassignedLead[]
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t("paymentsHeading", { count: payments.length })}
        </h2>
        <ImportSquarePaymentsButton />
        <UnlinkedPaymentsTable
          payments={payments}
          brands={brands}
          defaultBrandId={defaultBrandId}
        />
      </section>

      <PbSessionQueue rows={pbSessionQueue} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t("appointmentsHeading", { count: appointments.length })}
        </h2>
        <ImportSquareBookingsButton />
        <UnlinkedAppointmentsTable
          appointments={appointments}
          brands={brands}
          defaultBrandId={defaultBrandId}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Leads sin marca ({unassignedLeads.length})
        </h2>
        <p className="text-xs text-muted-foreground -mt-1">
          Leads creados por un pago/cita de una oferta no mapeada. Reasígnalos a
          la clínica correcta; si la persona ya existe ahí, ofrece fusionar.
        </p>
        <UnassignedLeadsTable
          leads={unassignedLeads}
          brands={brands}
          defaultBrandId={defaultBrandId}
        />
      </section>
    </div>
  )
}
