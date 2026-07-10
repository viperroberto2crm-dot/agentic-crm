import { notFound } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createAdminClient } from "@/lib/supabase/admin"
import { getEligibleIntakeBrand } from "@/lib/intake/eligible-brands"
import { submitPublicIntake } from "../actions"
import { IntakeForm } from "./_components/intake-form"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type SB = SupabaseClient<Database>

// Página PÚBLICA (tablet en clínica). Sin login. Fuera del route group (app).
// El middleware permite /intake/ como ruta pública.
export default async function PublicIntakePage({
  params,
}: {
  params: Promise<{ brand: string }>
}) {
  const { brand: brandSlug } = await params

  const sb = createAdminClient() as unknown as SB
  const brand = await getEligibleIntakeBrand(sb, brandSlug)
  if (!brand) notFound()

  const accent = brand.brand_color || "#0E5F4C"

  return (
    <main
      className="min-h-screen w-full flex items-start sm:items-center justify-center p-4 sm:p-8"
      style={{ background: `linear-gradient(160deg, ${accent}14, #F7F5F0 60%)` }}
    >
      <div className="w-full max-w-2xl">
        <div
          className="bg-white rounded-3xl shadow-[0_1px_2px_rgba(26,46,40,0.05),0_24px_60px_-24px_rgba(26,46,40,0.28)] border border-[#ECE3D3] p-6 sm:p-10"
          style={{ borderTop: `4px solid ${accent}` }}
        >
          <IntakeForm
            action={submitPublicIntake}
            mode="public"
            brandSlug={brand.slug}
            brandName={brand.name}
            brandColor={brand.brand_color}
            defaultLang="es"
          />
        </div>
      </div>
    </main>
  )
}
