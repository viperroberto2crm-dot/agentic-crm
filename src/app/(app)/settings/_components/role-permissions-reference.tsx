"use client"

import { ChevronDown, ShieldCheck } from "lucide-react"

/**
 * Referencia de permisos por rol (matriz roles × capacidades). Datos basados en
 * los permisos REALES del código. Desplegable para no estorbar la lista de
 * usuarios. Estilo Horizon (crema/teal).
 */

type Cell = boolean | string

const ROLES = [
  { key: "rep", label: "Vendedor" },
  { key: "manager", label: "Manager" },
  { key: "provider", label: "Proveedor" },
  { key: "admin", label: "Admin" },
] as const

type RoleKey = (typeof ROLES)[number]["key"]

const CAPS: { label: string; cells: Record<RoleKey, Cell> }[] = [
  {
    label: "Pacientes que ve",
    cells: { rep: "Solo los suyos", manager: "Todos (sus marcas)", provider: "Solo sus citas", admin: "Todas las marcas" },
  },
  {
    label: "Registrar venta / cobrar",
    cells: { rep: "Sus leads", manager: true, provider: false, admin: true },
  },
  {
    label: "Ver dinero / dashboard",
    cells: { rep: "Lo suyo", manager: "Todo", provider: false, admin: "Todo" },
  },
  {
    label: "Mandar SMS a pacientes",
    cells: { rep: true, manager: true, provider: false, admin: true },
  },
  {
    label: "Reasignar leads",
    cells: { rep: false, manager: true, provider: false, admin: true },
  },
  {
    label: "Borrar leads (en bloque)",
    cells: { rep: false, manager: true, provider: false, admin: true },
  },
  {
    label: "Aprobar envíos",
    cells: { rep: false, manager: true, provider: "Sus citas", admin: true },
  },
  {
    label: "Configuración",
    cells: { rep: "Perfil + Productos", manager: "Solo perfil", provider: "Solo perfil", admin: "Todo" },
  },
  {
    label: "Usuarios / marcas / integraciones",
    cells: { rep: false, manager: false, provider: false, admin: true },
  },
]

function CellView({ v }: { v: Cell }) {
  if (v === true) return <span className="text-[#2E8B6F] font-bold text-sm">✓</span>
  if (v === false) return <span className="text-[#D0A3A0] text-sm">✕</span>
  return <span className="text-[11px] leading-tight text-[#5C6F68]">{v}</span>
}

export function RolePermissionsReference() {
  return (
    <details className="group rounded-xl border border-[#E8E4DC] bg-white overflow-hidden">
      <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none list-none hover:bg-[#FBFAF7] transition-colors">
        <ShieldCheck className="w-4 h-4 text-[#2E8B6F]" />
        <span className="text-sm font-semibold text-[#20342C]">Permisos por rol</span>
        <span className="text-xs text-[#93A39D]">— qué puede hacer cada quien</span>
        <ChevronDown className="w-4 h-4 text-[#93A39D] ml-auto transition-transform group-open:rotate-180" />
      </summary>

      <div className="border-t border-[#EAE3D5] overflow-x-auto">
        <table className="w-full text-sm min-w-[36rem]">
          <thead>
            <tr className="bg-[#FBFAF7]">
              <th className="text-left font-semibold text-[#5C6F68] text-xs uppercase tracking-wide px-4 py-2.5">
                Capacidad
              </th>
              {ROLES.map((r) => (
                <th key={r.key} className="text-center font-semibold text-[#20342C] text-[13px] px-3 py-2.5 whitespace-nowrap">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPS.map((cap, i) => (
              <tr key={cap.label} className={i % 2 ? "bg-[#FBFAF7]/50" : ""}>
                <td className="text-left text-[#3B4E49] px-4 py-2.5 align-middle">{cap.label}</td>
                {ROLES.map((r) => (
                  <td key={r.key} className="text-center px-3 py-2.5 align-middle">
                    <CellView v={cap.cells[r.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-[#93A39D] px-4 py-2.5 border-t border-[#EAE3D5] leading-snug">
        Resumen: <b className="text-[#5C6F68]">Admin</b> = todo. <b className="text-[#5C6F68]">Manager</b> = toda la
        operación (leads, dinero, reasignar, envíos, SMS) pero sin configuración.
        <b className="text-[#5C6F68]"> Vendedor</b> = solo sus leads y su dinero.
        <b className="text-[#5C6F68]"> Proveedor</b> = solo sus citas, sin dinero ni SMS.
      </p>
    </details>
  )
}
