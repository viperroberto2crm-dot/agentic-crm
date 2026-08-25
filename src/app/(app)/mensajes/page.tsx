import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getTranslations } from "next-intl/server"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { fetchThreads, type ThreadSummary } from "@/lib/queries/messages"
import { isWhatsAppConfigured } from "@/lib/integrations/whatsapp"
import { Inbox } from "./_components/inbox"

/**
 * Bandeja unificada. Existe por una razón concreta: hasta ahora los mensajes
 * solo se veían dentro de la ficha de un paciente, así que **todo lo que
 * escribía alguien que todavía NO era lead se guardaba y nadie lo veía nunca**.
 * Aquí se ve, y se puede convertir en paciente de un clic.
 */

export const dynamic = "force-dynamic"

type TypedClient = SupabaseClient<Database>

export default async function MensajesPage() {
  const sb = (await createClient()) as unknown as TypedClient
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect("/login")

  const [profileRes, cookieStore, t] = await Promise.all([
    sb.from("users").select("role").eq("id", user.id).single(),
    cookies(),
    getTranslations("inbox"),
  ])
  const role = (profileRes.data?.role ?? "rep") as string
  // Igual que la ficha: un provider no ve conversaciones con pacientes.
  if (role === "provider") redirect("/appointments")

  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  // Marcas del usuario (para el formulario de "crear paciente").
  const { data: brandsRaw } = await sb
    .from("user_brands")
    .select("brands(id, name)")
    .eq("user_id", user.id)
  const brands = (brandsRaw ?? [])
    .map((row) => (row as unknown as { brands: { id: string; name: string } | null }).brands)
    .filter((b): b is { id: string; name: string } => !!b)
    .sort((a, b) => a.name.localeCompare(b.name))

  const [{ threads, truncated, error: threadsError }, waEnabled] = await Promise.all([
    fetchThreads(sb, { brandId }),
    isWhatsAppConfigured(),
  ])

  // Mensajes que llegaron a un número que ninguna marca reclama: la RLS los
  // esconde de TODOS. Sin este bucket admin se pierden para siempre.
  let unbranded: ThreadSummary[] = []
  if (role === "admin") {
    const admin = createAdminClient() as unknown as TypedClient
    unbranded = (await fetchThreads(admin, { onlyUnbranded: true })).threads
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[#3A4A44]">{t("title")}</h1>
        <p className="text-sm text-[#5C6F68] mt-0.5">{t("subtitle")}</p>
      </div>

      <Inbox
        threads={threads}
        unbranded={unbranded}
        brands={brands}
        truncated={truncated}
        loadError={threadsError ?? null}
        waEnabled={waEnabled}
        isAdmin={role === "admin"}
      />
    </div>
  )
}
