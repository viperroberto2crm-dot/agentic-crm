import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { ProfileForm } from "./_components/profile-form"
import { BrandForm } from "./_components/brand-form"

type TypedClient = SupabaseClient<Database>

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient

  const [profileRes, cookieStore, params] = await Promise.all([
    sb.from("users").select("id, name, email, cell_phone, role").eq("id", user.id).single(),
    cookies(),
    searchParams,
  ])

  const profile = profileRes.data
  const role = (profile?.role ?? "rep") as string
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  const sp = params as Record<string, string | string[] | undefined>
  const tab = typeof sp.tab === "string" ? sp.tab : "perfil"

  type BrandData = { id: string; name: string; brand_color: string | null; logo_url: string | null }
  let brand: BrandData | null = null
  if (role === "admin" && brandId) {
    const { data } = await sb
      .from("brands")
      .select("id, name, brand_color, logo_url")
      .eq("id", brandId)
      .single()
    brand = data as BrandData | null
  }

  const tabs = [
    { value: "perfil", label: "Perfil" },
    ...(role === "admin" ? [{ value: "marca", label: "Marca" }] : []),
  ]

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">

      <h1 className="text-xl font-semibold text-zinc-100">Configuración</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800">
        {tabs.map((t) => (
          <Link
            key={t.value}
            href={`/settings?tab=${t.value}`}
            className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
              tab === t.value
                ? "border-current text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
            style={tab === t.value ? { borderColor: "var(--brand)" } : undefined}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Tab content */}
      <div className="pt-2">
        {tab === "perfil" && profile && (
          <ProfileForm
            name={profile.name}
            email={profile.email}
            cellPhone={profile.cell_phone ?? null}
          />
        )}
        {tab === "marca" && brand && role === "admin" && (
          <BrandForm
            brandId={brand.id}
            name={brand.name}
            brandColor={brand.brand_color}
            logoUrl={brand.logo_url}
          />
        )}
        {tab === "marca" && !brand && role === "admin" && (
          <p className="text-sm text-zinc-600">Selecciona una marca primero desde el selector en el sidebar.</p>
        )}
      </div>

    </div>
  )
}
