import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { resolveAuthorizedBrandId } from "@/lib/queries/brand-access"
import { ProfileForm } from "./_components/profile-form"
import { BrandForm } from "./_components/brand-form"
import { UsersTab, type UserRow } from "./_components/users-tab"
import { ProductsTab, type ProductRow } from "./_components/products-tab"
import { ClinicsTab, type ClinicRow } from "./_components/clinics-tab"
import { BrandsTab, type BrandRow } from "./_components/brands-tab"
import {
  TrackingNumbersTab,
  type TrackingNumberRow,
  type BrandOption,
} from "./_components/tracking-numbers-tab"
import {
  OfferBrandMapTab,
  type OfferMapRow,
} from "./_components/offer-brand-map-tab"
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
  // Validar la marca de la cookie contra user_brands (admin = acceso global).
  // Un rep que cambie la cookie a otra marca ya no puede leer su catálogo de
  // productos (bloque admin-client de abajo) porque brandId será null.
  const brandId = await resolveAuthorizedBrandId(sb, user.id, brandSlug)

  const sp = params as Record<string, string | string[] | undefined>
  const tab = typeof sp.tab === "string" ? sp.tab : "perfil"

  if (role === "provider" && tab !== "perfil") redirect("/settings?tab=perfil")
  if (role === "rep" && tab !== "perfil" && tab !== "productos") redirect("/settings?tab=perfil")
  if (role !== "admin" && tab === "clinicas") redirect("/settings?tab=perfil")
  if (role !== "admin" && tab === "marcas") redirect("/settings?tab=perfil")
  if (role !== "admin" && tab === "tracking") redirect("/settings?tab=perfil")
  if (role !== "admin" && tab === "ofertas") redirect("/settings?tab=perfil")

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

  // ── Tracking numbers (admin) ────────────────────────────────────────────────
  let trackingNumbers: TrackingNumberRow[] = []
  let trackingBrands: BrandOption[] = []
  if (role === "admin") {
    try {
      const admin = createAdminClient()
      // tracking_numbers no esta en Database types — usamos cast puntual
      const tnRes = await (admin
        .from("tracking_numbers" as never)
        .select("*")
        .order("active", { ascending: false })
        .order("created_at", { ascending: false }) as unknown as Promise<{
          data: TrackingNumberRow[] | null
          error: { message: string } | null
        }>)
      if (tnRes.error) {
        console.error("[settings] tracking_numbers query error:", tnRes.error.message)
      }
      trackingNumbers = (tnRes.data ?? []) as TrackingNumberRow[]
      // brands para el filtro y el select del dialog (incluye inactivas por si hay TN historicas)
      trackingBrands = (allBrands ?? []).map((b) => ({ id: b.id, name: b.name }))
    } catch (e) {
      console.error("[settings] tracking_numbers fetch threw:", e)
    }
  }

  // ── Offer → brand map (admin) ───────────────────────────────────────────────
  let offerMaps: OfferMapRow[] = []
  let offerBrands: BrandOption[] = []
  if (role === "admin") {
    try {
      const admin = createAdminClient()
      const { data: omData, error: omErr } = await admin
        .from("offer_brand_map")
        .select("*")
        .order("active", { ascending: false })
        .order("created_at", { ascending: false })
      if (omErr) console.error("[settings] offer_brand_map query error:", omErr.message)
      offerMaps = (omData ?? []) as OfferMapRow[]
      // Solo marcas activas para asignar ofertas nuevas.
      offerBrands = (allBrands ?? [])
        .filter((b) => b.active !== false)
        .map((b) => ({ id: b.id, name: b.name }))
    } catch (e) {
      console.error("[settings] offer_brand_map fetch threw:", e)
    }
  }

  let brandUsers: UserRow[] = []
  if (role === "admin" && brandId) {
    try {
      // Usar admin client: SSR client puede tener problemas con RLS sobre user_brands
      // después de revalidatePath cuando cambian roles. Admin bypass es safer acá.
      const admin = createAdminClient()
      const { data: ubRows, error: ubErr } = await admin
        .from("user_brands")
        .select("user_id")
        .eq("brand_id", brandId)
      if (ubErr) console.error("[settings] user_brands query error:", ubErr.message)
      const ids = (ubRows ?? []).map((r) => r.user_id)
      if (ids.length) {
        const { data: usersData, error: usersErr } = await admin
          .from("users")
          .select("id, name, email, role, cell_phone, active, created_at")
          .in("id", ids)
          .order("name")
        if (usersErr) console.error("[settings] users query error:", usersErr.message)
        brandUsers = (usersData ?? []) as UserRow[]
      }
    } catch (e) {
      console.error("[settings] brandUsers fetch threw:", e)
    }
  }

  const adminTabs = role === "admin"
    ? [
        { value: "marca", label: t("tabMarca") },
        { value: "clinicas", label: t("tabClinicas") },
        { value: "marcas", label: t("tabMarcas") },
        { value: "tracking", label: t("tabTracking") },
        { value: "ofertas", label: t("tabOfertas") },
        { value: "usuarios", label: t("tabUsuarios") },
      ]
    : []
  const tabs = role === "provider"
    ? [{ value: "perfil", label: t("tabPerfil") }]
    : [
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
        {tab === "tracking" && role === "admin" && (
          <TrackingNumbersTab
            trackingNumbers={trackingNumbers}
            brands={trackingBrands}
            defaultBrandId={brandId}
          />
        )}
        {tab === "ofertas" && role === "admin" && (
          <OfferBrandMapTab
            offerMaps={offerMaps}
            brands={offerBrands}
            defaultBrandId={brandId}
          />
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
