import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import type { UserRole } from "./role-guards"

/**
 * Permisos OPERATIVOS editables por rol (toggles seguros). El admin siempre los
 * tiene; el provider NUNCA (piso duro de seguridad, aquí en código). Solo rep y
 * manager son configurables, y solo para estas capacidades seguras — nunca para
 * el aislamiento de pacientes por marca ni para saltarse los bloqueos de PHI/dinero
 * del provider (eso vive fijo en el código y en RLS).
 */

export type Capability =
  | "see_all_leads"   // ver todos los leads de su(s) marca(s), no solo los asignados
  | "reassign_leads"  // reasignar leads a otro vendedor
  | "bulk_delete"     // borrar leads (incl. en bloque)
  | "charge"          // cobrar / registrar venta
  | "send_sms"        // mandar SMS a pacientes
  | "export_data"     // exportar CSV

export const CAPABILITIES: Capability[] = [
  "see_all_leads",
  "reassign_leads",
  "bulk_delete",
  "charge",
  "send_sms",
  "export_data",
]

/** Roles configurables (admin fijo en ✓, provider fijo en ✕). */
export type EditableRole = "rep" | "manager"

/** Default = comportamiento actual del sistema. Correr o no la migración no
 *  cambia nada hasta que el admin toque un toggle. */
const DEFAULTS: Record<Capability, Record<EditableRole, boolean>> = {
  see_all_leads:  { rep: false, manager: true },
  reassign_leads: { rep: false, manager: true },
  bulk_delete:    { rep: false, manager: true },
  charge:         { rep: true,  manager: true },
  send_sms:       { rep: true,  manager: true },
  export_data:    { rep: true,  manager: true },
}

export type RolePermissions = Record<Capability, Record<EditableRole, boolean>>

export function defaultPermissions(): RolePermissions {
  const out = {} as RolePermissions
  for (const cap of CAPABILITIES) out[cap] = { ...DEFAULTS[cap] }
  return out
}

/**
 * ¿El rol tiene la capacidad? PISO DURO: admin siempre sí; provider siempre NO
 * (ninguna de estas capacidades es tocable para provider — datos/dinero). rep y
 * manager según la config (o el default si no hay fila).
 */
export function can(role: UserRole | string, cap: Capability, perms: RolePermissions): boolean {
  if (role === "admin") return true
  if (role === "rep" || role === "manager") return perms[cap]?.[role] ?? DEFAULTS[cap][role]
  return false // provider y cualquier otro → nunca
}

/**
 * Lee la config guardada (role_permissions) y la mezcla con los defaults. Si la
 * tabla no existe (migración no corrida) o falla, regresa los defaults → el
 * sistema se comporta EXACTAMENTE como hoy. Nunca rompe la página.
 */
export async function getRolePermissions(
  sb: SupabaseClient<Database>,
): Promise<RolePermissions> {
  const perms = defaultPermissions()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (sb as any)
      .from("role_permissions")
      .select("role, capability, allowed")
    if (error || !data) return perms
    for (const row of data as { role: string; capability: string; allowed: boolean }[]) {
      const cap = row.capability as Capability
      const role = row.role as EditableRole
      if ((role === "rep" || role === "manager") && cap in perms && typeof row.allowed === "boolean") {
        perms[cap][role] = row.allowed
      }
    }
  } catch {
    /* tabla ausente / RLS → defaults (comportamiento actual) */
  }
  return perms
}
