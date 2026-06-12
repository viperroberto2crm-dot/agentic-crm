import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { formatApptDateTime } from "@/lib/datetime"
import { MarkAsShippedButton } from "./_components/mark-as-shipped-button"
import { RemoveFromShippingButton } from "./_components/remove-from-shipping-button"
import { getTranslations } from "next-intl/server"

type TypedClient = SupabaseClient<Database>

/**
 * /shipping — lista de citas aprobadas por el provider que esperan envío.
 *
 * Flujo:
 *   1. Provider termina cita y la "Aprueba para envío" (con notas) desde el
 *      modal Edit Appointment.
 *   2. Admin/manager entra a /shipping → ve la lista de pendientes.
 *   3. Click "Marcar enviado" → la cita desaparece de la lista.
 *
 * Solo admin/manager pueden acceder. Provider y rep son redirigidos.
 */
export const dynamic = "force-dynamic"

export default async function ShippingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const t = await getTranslations("shipping")

  const { data: profile } = await sb
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single()
  const role = (profile?.role ?? "rep") as string
  if (role !== "admin" && role !== "manager") {
    redirect("/dashboard")
  }

  const cookieStore = await cookies()
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = (sb as any)
    .from("appointments")
    .select(
      `id, scheduled_at, type, service, notes, provider_notes,
       provider_approved_at, address_line1, address_line2, city, state, zip, clinic_id,
       lead:leads!appointments_lead_id_fkey(id, first_name, last_name, phone, address_line1, address_line2, city, state, zip),
       provider:users!appointments_provider_approved_by_fkey(id, name),
       brand:brands!appointments_brand_id_fkey(id, name)`,
    )
    .eq("provider_approved", true)
    .is("shipped_at", null)
    .order("provider_approved_at", { ascending: false })
    .limit(200)
  if (brandId) query = query.eq("brand_id", brandId)

  const { data: rawAppts } = await query
  const appts = (rawAppts ?? []) as Array<{
    id: string
    scheduled_at: string
    type: string
    service: string | null
    notes: string | null
    provider_notes: string | null
    provider_approved_at: string
    address_line1: string | null
    address_line2: string | null
    city: string | null
    state: string | null
    zip: string | null
    clinic_id: string | null
    lead: {
      id: string
      first_name: string
      last_name: string | null
      phone: string
      address_line1: string | null
      address_line2: string | null
      city: string | null
      state: string | null
      zip: string | null
    } | null
    provider: { id: string; name: string } | null
    brand: { id: string; name: string } | null
  }>

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t("title")}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{t("subtitle")}</p>
        </div>
        <p className="text-xs text-gray-400">
          {appts.length} {appts.length === 1 ? t("pending") : t("pendingPlural")}
        </p>
      </div>

      {appts.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center">
          <p className="text-sm text-gray-500">{t("emptyState")}</p>
          <p className="text-xs text-gray-400 mt-1">{t("emptyHint")}</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {appts.map((a) => {
            // Dirección de envío: prefer lead address, fallback appointment address
            const addr1 = a.lead?.address_line1 ?? a.address_line1
            const addr2 = a.lead?.address_line2 ?? a.address_line2
            const city = a.lead?.city ?? a.city
            const state = a.lead?.state ?? a.state
            const zip = a.lead?.zip ?? a.zip
            const fullAddr = [addr1, addr2, [city, state, zip].filter(Boolean).join(", ")]
              .filter(Boolean)
              .join(" · ")
            const leadName = a.lead
              ? `${a.lead.first_name} ${a.lead.last_name ?? ""}`.trim()
              : "—"
            return (
              <div key={a.id} className="p-4 flex items-start justify-between gap-4 hover:bg-gray-50">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    {a.lead?.id ? (
                      <Link
                        href={`/leads/${a.lead.id}`}
                        className="text-sm font-semibold text-gray-900 hover:text-gray-700"
                      >
                        {leadName}
                      </Link>
                    ) : (
                      <span className="text-sm font-semibold text-gray-900">{leadName}</span>
                    )}
                    {a.lead?.phone && (
                      <span className="text-xs text-gray-400 font-mono">{a.lead.phone}</span>
                    )}
                    {a.brand?.name && (
                      <span className="text-[10px] uppercase tracking-wider text-gray-400">
                        {a.brand.name}
                      </span>
                    )}
                  </div>

                  {a.service && (
                    <p className="text-xs text-gray-700">
                      <span className="font-medium">{t("product")}:</span> {a.service}
                    </p>
                  )}

                  {fullAddr && (
                    <p className="text-xs text-gray-600">
                      <span className="font-medium">{t("shipTo")}:</span> {fullAddr}
                    </p>
                  )}
                  {!fullAddr && (
                    <p className="text-xs text-amber-600">
                      ⚠ {t("noAddress")}
                    </p>
                  )}

                  {a.provider_notes && (
                    <div className="text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded p-2 mt-1">
                      <p className="font-medium text-amber-900 mb-0.5">
                        {t("providerNotes")}
                        {a.provider?.name ? ` · ${a.provider.name}` : ""}
                      </p>
                      <p className="whitespace-pre-wrap">{a.provider_notes}</p>
                    </div>
                  )}

                  <p className="text-[10px] text-gray-400 mt-1">
                    {t("apptDate")}: {formatApptDateTime(a.scheduled_at)} ·{" "}
                    {t("approvedAt")}: {formatApptDateTime(a.provider_approved_at)}
                  </p>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  <RemoveFromShippingButton appointmentId={a.id} />
                  <MarkAsShippedButton appointmentId={a.id} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
