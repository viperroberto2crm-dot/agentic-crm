import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createAdminClient } from "@/lib/supabase/admin"
import { listEligibleIntakeBrands } from "@/lib/intake/eligible-brands"
import { ClinicPicker, type PickerBrand } from "./_components/clinic-picker"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type SB = SupabaseClient<Database>

const FALLBACK_COLORS: Record<string, string> = {
  "si-se-pierde": "#0acdc0",
  "sunny-slim": "#e2c11d",
  "la-esperanza": "#0206ed",
}

// Landing PÚBLICA (kiosco/tablet en clínica). Sin login. La persona elige su
// clínica y pasa a /intake/[slug]. El middleware permite /admision como público.
export default async function AdmisionLandingPage() {
  const sb = createAdminClient() as unknown as SB
  const eligible = await listEligibleIntakeBrands(sb)

  const brands: PickerBrand[] = eligible.map((b) => ({
    slug: b.slug,
    name: b.name,
    color: b.brand_color ?? FALLBACK_COLORS[b.slug] ?? "#0E5F4C",
  }))

  return (
    <main className="min-h-screen w-full flex items-start sm:items-center justify-center p-4 sm:p-8 bg-[#F7F5F0]">
      <ClinicPicker brands={brands} />
    </main>
  )
}
