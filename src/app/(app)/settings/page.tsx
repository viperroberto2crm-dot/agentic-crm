import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { ProfileForm } from "./_components/profile-form"
import { BrandForm } from "./_components/brand-form"
import { UsersTab, type UserRow } from "./_components/users-tab"
import { ProductsTab, type ProductRow } from "./_components/products-tab"
import { ClinicsTab, type ClinicRow } from "./_components/clinics-tab"
import { BrandsTab, type BrandRow } from "./_components/brands-tab"
import { getTranslations } from "next-intl/server"

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
  const t = await getTranslations("settings")

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

  if (role === "rep" && tab !== "perfil" && tab !== "productos") redirect("/settings?tab=perfil")
  if (role !== "admin" && tab === "clinicas") redirect("/settings?tab=perfil")
  if (role !== "admin" && tab === "marcas") redirect("/settings?tab=perfil")

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

  let products: ProductRow[] = []
  if ((role === "admin" || role === "rep") && brandId) {
    try {
      const admin = createAdminClient()
      const { data: productsData, error: prodErr } = await admin
        .from("products")
        .select("*")
        .eq("brand_id", brandId)
        .order("sort_order")
        .order("name")
      if (prodErr) console.error("[settings] products query error:", prodErr.message)
      products = (productsData ?? []) as ProductRow[]
    } catch (e) {
      console.error("[settings] products fetch threw:", e)
    }
  }
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))]

  let clinics: ClinicRow[] = []
  if (role === "admin" && brandId) {
    try {
      const admin = createAdminClient()
      const { data: clinicsData, error: clinicsErr } = await admin
        .from("clinics")
        .select("*")
        .eq("brand_id", brandId)
        .order("active", { ascending: false })
        .order("name")
      if (clinicsErr) console.error("[settings] clinics query error:", clinicsErr.message)
      clinics = (clinicsData ?? []) as ClinicRow[]
    } catch (e) {
      console.error("[settings] clinics fetch threw:", e)
    }
  }

  let allBrands: BrandRow[] = []
  if (role === "admin") {
    try {
      const admin = createAdminClient()
      const { data: brandsData, error: brandsErr } = await admin
        .from("brands")
        .select("*")
        .order("active", { ascending: false })
        .order("name")
      if (brandsErr) console.error("[settings] brands query error:", brandsErr.message)
      allBrands = (brandsData ?? []) as BrandRow[]
    } catch (e) {
      console.error("[settings] brands fetch threw:", e)
    }
  }

  let brandUsers: UserRow[] = []
  if (role === "admin" && brandId) {
    const { data: ubRows } = await sb
      .from("user_brands")
      .select("user_id")
      .eq("brand_id", brandId)
    const ids = (ubRows ?? []).map((r) => r.user_id)
    if (ids.length) {
      const { data: usersData } = await sb
        .from("users")
        .select("id, name, email, role, cell_phone, active, created_at")
        .in("id", ids)
        .order("name")
      brandUsers = (usersData ?? []) as UserRow[]
    }
  }

  const adminTabs = role === "admin"
    ? [
        { value: "marca", label: t("tabMarca") },
        { value: "clinicas", label: t("tabClinicas") },
        { value: "marcas", label: t("tabMarcas") },
        { value: "usuarios", label: t("tabUsuarios") },
      ]
    : []
  const tabs = [
    { value: "perfil", label: t("tabPerfil") },
    { value: "productos", label: t("tabProductos") },
    ...adminTabs,
  ]

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">

      <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>

      <div className="flex gap-1 border-b border-border">
        {tabs.map((tb) => (
          <Link
            key={tb.value}
            href={`/settings?tab=${tb.value}`}
            className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
              tab === tb.value
                ? "border-current text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            style={tab === tb.value ? { borderColor: "var(--brand)" } : undefined}
          >
            {tb.label}
          </Link>
        ))}
      </div>

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
          <p className="text-sm text-zinc-600">{t("selectBrand")}</p>
        )}
        {tab === "productos" && (role === "admin" || role === "rep") && (
          brandId
            ? <ProductsTab products={products} brandId={brandId} categories={categories} readonly={role !== "admin"} />
            : <p className="text-sm text-muted-foreground">{t("selectBrand")}</p>
        )}
        {tab === "clinicas" && role === "admin" && (
          brandId
            ? <ClinicsTab clinics={clinics} brandId={brandId} />
            : <p className="text-sm text-muted-foreground">{t("selectBrand")}</p>
        )}
        {tab === "marcas" && role === "admin" && (
          <BrandsTab brands={allBrands} />
        )}
        {tab === "usuarios" && role === "admin" && (
          brandId
            ? <UsersTab users={brandUsers} brandId={brandId} currentUserId={user.id} />
            : <p className="text-sm text-muted-foreground">{t("selectBrand")}</p>
        )}
      </div>

    </div>
  )
}
