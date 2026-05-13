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

  // Reps can only access their profile tab
  if (role === "rep" && tab !== "perfil") redirect("/settings?tab=perfil")

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
  if (role === "admin" && brandId) {
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
        { value: "marca", label: "Marca" },
        { value: "productos", label: "Productos" },
        { value: "usuarios", label: "Usuarios" },
      ]
    : []
  const tabs = [{ value: "perfil", label: "Perfil" }, ...adminTabs]

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">

      <h1 className="text-xl font-semibold text-foreground">Configuración</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <Link
            key={t.value}
            href={`/settings?tab=${t.value}`}
            className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
              tab === t.value
                ? "border-current text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
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
        {tab === "productos" && role === "admin" && (
          brandId
            ? <ProductsTab products={products} brandId={brandId} categories={categories} />
            : <p className="text-sm text-muted-foreground">Selecciona una marca primero desde el selector en el sidebar.</p>
        )}
        {tab === "usuarios" && role === "admin" && (
          brandId
            ? <UsersTab users={brandUsers} brandId={brandId} currentUserId={user.id} />
            : <p className="text-sm text-muted-foreground">Selecciona una marca primero desde el selector en el sidebar.</p>
        )}
      </div>

    </div>
  )
}
