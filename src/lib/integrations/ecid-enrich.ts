import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { lookupEnhancedCallerId } from "./800com"

/**
 * Auto-enriquece un lead recién creado con datos de 800.com ECID.
 *
 * NUNCA throws — si algo falla, loggea y se queda. La creación del lead
 * NUNCA debe romperse por un fallo del lookup.
 *
 * Merge defensivo (idéntico al backfill):
 *   - first_name: solo si está vacío O parece teléfono
 *   - last_name, email, address_line1/2, city, state, zip: solo si está vacío
 *   - NUNCA toca: status, source, brand_id, assigned_rep_id, custom_fields, notes
 */
export async function maybeEnrichLead(
  sb: SupabaseClient<Database>,
  leadId: string,
): Promise<void> {
  try {
    const { data: lead } = await sb
      .from("leads")
      .select("id, phone, first_name, last_name, email, address_line1, address_line2, city, state, zip")
      .eq("id", leadId)
      .maybeSingle()

    if (!lead) return
    const phone = (lead.phone ?? "").trim()
    if (!phone) return

    // Si ya tiene dirección, no llamar al API (ahorra costo)
    if (lead.address_line1 && lead.address_line1.trim()) return

    const res = await lookupEnhancedCallerId(phone, false)
    if (res.matchStatus !== "found" || !res.data) return
    const ecid = res.data

    const isPhonelikeOrEmpty = (s: string | null | undefined): boolean => {
      if (!s) return true
      const t = s.trim()
      if (!t) return true
      return /^\+?\d{7,}$/.test(t.replace(/[\s\-().]/g, ""))
    }
    const emptyStr = (s: string | null | undefined): boolean => !s || s.trim() === ""

    const updates: Record<string, string> = {}
    if (isPhonelikeOrEmpty(lead.first_name) && ecid.firstName) updates.first_name = ecid.firstName
    if (emptyStr(lead.last_name) && ecid.lastName) updates.last_name = ecid.lastName
    if (emptyStr(lead.email) && ecid.emails && ecid.emails.length > 0) updates.email = ecid.emails[0]
    if (emptyStr(lead.address_line1) && ecid.streetLine_1) updates.address_line1 = ecid.streetLine_1
    if (emptyStr(lead.address_line2) && ecid.streetLine_2) updates.address_line2 = ecid.streetLine_2
    if (emptyStr(lead.city) && ecid.city) updates.city = ecid.city
    if (emptyStr(lead.state) && ecid.region) updates.state = ecid.region
    if (emptyStr(lead.zip) && ecid.postalCode) updates.zip = ecid.postalCode

    if (Object.keys(updates).length === 0) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb as any).from("leads").update(updates).eq("id", leadId)
    if (error) {
      console.warn(`[ecid-enrich] failed to update lead ${leadId}: ${error.message}`)
    }
  } catch (err) {
    console.warn(`[ecid-enrich] lookup failed for lead ${leadId}:`, err instanceof Error ? err.message : err)
  }
}
