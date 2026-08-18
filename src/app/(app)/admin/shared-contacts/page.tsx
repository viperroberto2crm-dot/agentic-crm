import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowRight, Users } from "lucide-react"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type TypedClient = SupabaseClient<Database>
type LeadStatus = Database["public"]["Enums"]["lead_status"]

export const dynamic = "force-dynamic"

// Vista admin de SOLO LECTURA: personas (mismo teléfono) que aparecen como lead
// en MÁS DE UNA clínica/marca. Para que managers vean el traslape y coordinen
// (dejar de pelearse por el lead). NO edita nada. Solo admin (PII cross-brand).

const STATUS_CHIP: Record<LeadStatus, { label: string; bg: string; text: string; dot: string }> = {
  new:             { label: "Nuevo",         bg: "#EAF0FD", text: "#4E79D6", dot: "#5F8CE6" },
  contacted:       { label: "Contactado",    bg: "#FBF1DD", text: "#B67C22", dot: "#D79A3E" },
  qualified:       { label: "Calificado",    bg: "#EFEAF9", text: "#6E5AA6", dot: "#8E7CC3" },
  appointment_set: { label: "Con cita",      bg: "#FCEEE4", text: "#C56A3E", dot: "#EF7B5C" },
  sold:            { label: "Vendido",       bg: "#E6F3EC", text: "#2E7E5B", dot: "#3FA278" },
  lost:            { label: "Perdido",       bg: "#FAEBEA", text: "#B85D5B", dot: "#D5807E" },
  on_hold:         { label: "En espera",     bg: "#F0EBE0", text: "#7C7259", dot: "#C7B48A" },
  not_interested:  { label: "No interesado", bg: "#EFEBE4", text: "#7C8B80", dot: "#A8B0A2" },
}

const GRADS = [
  "linear-gradient(150deg,#EF7B5C,#E2653F)", "linear-gradient(150deg,#3FA278,#2C6B57)",
  "linear-gradient(150deg,#5F8CE6,#3E63B8)", "linear-gradient(150deg,#E0A64E,#C88A2E)",
  "linear-gradient(150deg,#8E7CC3,#6E5AA6)", "linear-gradient(150deg,#D5807E,#B85D5B)",
]
const grad = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return GRADS[h % GRADS.length] }
const initials = (n: string) => { const p = (n || "?").trim().split(/\s+/); return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "") || "?").toUpperCase() }
const normPhone = (p: string | null) => (p || "").replace(/\D/g, "").slice(-10)
const fmtPhone = (p: string | null) => {
  const d = normPhone(p)
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p ?? "—")
}

type LeadRow = {
  id: string
  first_name: string
  last_name: string | null
  phone: string | null
  brand_id: string | null
  status: LeadStatus
  assigned_rep_id: string | null
  last_contacted_at: string | null
}

function daysAgo(iso: string | null): string {
  if (!iso) return "—"
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (d <= 0) return "hoy"
  if (d === 1) return "1d"
  return `${d}d`
}

export default async function SharedContactsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).single()
  if ((profile?.role ?? "rep") !== "admin") redirect("/")

  const admin = createAdminClient() as unknown as TypedClient

  // Traer leads (paginado defensivo para no truncar a 1000 en silencio).
  const leads: LeadRow[] = []
  let truncated = false
  const PAGE = 1000
  for (let p = 0; p < 10; p++) {
    const { data } = await admin
      .from("leads")
      .select("id, first_name, last_name, phone, brand_id, status, assigned_rep_id, last_contacted_at")
      .not("phone", "is", null)
      .neq("phone", "")
      .range(p * PAGE, p * PAGE + PAGE - 1)
    const batch = (data ?? []) as LeadRow[]
    leads.push(...batch)
    if (batch.length < PAGE) break
    if (p === 9) truncated = true
  }

  // Agrupar por teléfono normalizado; quedarnos con los que están en >1 marca.
  const byPhone = new Map<string, LeadRow[]>()
  for (const l of leads) {
    const k = normPhone(l.phone)
    if (k.length < 7) continue
    const arr = byPhone.get(k)
    if (arr) arr.push(l)
    else byPhone.set(k, [l])
  }
  const shared = [...byPhone.entries()]
    .map(([k, rows]) => ({ k, rows, brands: new Set(rows.map((r) => r.brand_id)) }))
    .filter((g) => g.brands.size > 1)
    .sort((a, b) => b.brands.size - a.brands.size || b.rows.length - a.rows.length)

  // Resolver nombres de marca y rep.
  const brandIds = new Set<string>()
  const repIds = new Set<string>()
  for (const g of shared) for (const r of g.rows) {
    if (r.brand_id) brandIds.add(r.brand_id)
    if (r.assigned_rep_id) repIds.add(r.assigned_rep_id)
  }
  const [brandsRes, repsRes] = await Promise.all([
    admin.from("brands").select("id, name"),
    repIds.size > 0 ? admin.from("users").select("id, name").in("id", [...repIds]) : Promise.resolve({ data: [] }),
  ])
  const brandName = new Map<string, string>()
  for (const b of (brandsRes.data ?? []) as { id: string; name: string }[]) brandName.set(b.id, b.name)
  const repName = new Map<string, string>()
  for (const u of (repsRes.data ?? []) as { id: string; name: string | null }[]) repName.set(u.id, u.name ?? "—")

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[#20342C]">Contactos compartidos</h1>
          <p className="text-[13px] text-[#93A39D] mt-1">
            Personas (mismo teléfono) que son lead en más de una clínica. Para coordinar y evitar que dos vendedores trabajen el mismo contacto.
          </p>
        </div>
        <span className="text-[13px] text-[#93A39D] tabular-nums shrink-0 mt-1">
          {shared.length} {shared.length === 1 ? "persona" : "personas"}
        </span>
      </div>

      {truncated && (
        <div className="rounded-xl bg-[#FCE9E2] text-[#C56A3E] px-3 py-2 text-[12.5px] font-semibold">
          ⚠ Hay más de 10,000 leads — la lista puede estar incompleta. Avísame para ajustar.
        </div>
      )}

      {shared.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#ECE3D3] py-14 text-center">
          <Users className="w-6 h-6 text-[#B7AE9C] mx-auto mb-2" />
          <p className="text-sm text-[#93A39D]">No hay contactos en varias clínicas. 🎉</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shared.map((g) => {
            const name = g.rows.map((r) => `${r.first_name} ${r.last_name ?? ""}`.trim()).find(Boolean) || "—"
            return (
              <div key={g.k} className="bg-card border border-[#ECE3D3] rounded-2xl shadow-[0_1px_2px_rgba(26,46,40,0.05),0_10px_28px_-14px_rgba(26,46,40,0.12)] overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-[#F1EADD] bg-[#FBF7EF]/50">
                  <span className="w-10 h-10 rounded-[13px] shrink-0 grid place-items-center text-white font-semibold text-[14px] shadow-[0_2px_6px_rgba(18,60,48,0.14)]" style={{ background: grad(name) }}>
                    {initials(name)}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-[15px] text-[#20342C] truncate">{name}</div>
                    <div className="text-[12.5px] text-[#93A39D] tabular-nums">{fmtPhone(g.rows[0].phone)}</div>
                  </div>
                  <span className="ml-auto inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-bold bg-[#FCE9E2] text-[#C56A3E] whitespace-nowrap">
                    en {g.brands.size} clínicas
                  </span>
                </div>
                <div className="divide-y divide-[#F1EADD]">
                  {g.rows.map((r) => {
                    const chip = STATUS_CHIP[r.status] ?? STATUS_CHIP.new
                    return (
                      <Link key={r.id} href={`/leads/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#FBF6EC] transition-colors">
                        <span className="w-2 h-2 rounded-full shrink-0 bg-[#2E8B6F]" />
                        <span className="font-semibold text-[13.5px] text-[#20342C] min-w-[130px] truncate">
                          {r.brand_id ? brandName.get(r.brand_id) ?? "—" : "Sin clínica"}
                        </span>
                        <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap" style={{ backgroundColor: chip.bg, color: chip.text }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: chip.dot }} />
                          {chip.label}
                        </span>
                        <span className="text-[12.5px] text-[#5C6F68] truncate">
                          Rep: {r.assigned_rep_id ? repName.get(r.assigned_rep_id) ?? "—" : "sin asignar"}
                        </span>
                        <span className="ml-auto text-[12px] text-[#93A39D] tabular-nums whitespace-nowrap">últ. contacto {daysAgo(r.last_contacted_at)}</span>
                        <ArrowRight className="w-4 h-4 text-[#B7AE9C] shrink-0" />
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
