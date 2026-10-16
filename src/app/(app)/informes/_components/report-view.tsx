import type { CallReport, NumberMonth } from "@/lib/reports/call-report-data"
import { BRAND_TIMEZONE } from "@/lib/datetime"

const STATUS: Record<string, string> = {
  new: "Nuevo",
  contacted: "Contactado",
  qualified: "Calificado",
  appointment_set: "Cita agendada",
  sold: "Vendido",
  lost: "Perdido",
  on_hold: "En espera",
  not_interested: "No interesado",
}

const KIND: Record<string, string> = {
  never_reached: "No llegó al agente",
  redialed_talked: "Volvió a llamar y habló",
  reached_hung_up: "Llegó al agente y colgó",
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

function monthLabel(key: string): string {
  const [y, m] = key.split("-")
  const name = MONTHS[Number(m) - 1] ?? key
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`
}

export function formatPhone(e164: string): string {
  const d = e164.replace(/^\+1/, "")
  return /^\d{10}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : e164
}

function fmtDuration(s: number | null): string {
  if (!s) return "—"
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`
}

function fmtWhen(iso: string): string {
  return new Intl.DateTimeFormat("es-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: BRAND_TIMEZONE,
  }).format(new Date(iso))
}

const TH = "text-left text-[10px] uppercase tracking-widest font-semibold text-[#93A39D] px-3 py-2"
const TD = "px-3 py-1.5 text-sm text-[#20342C] border-t border-[#ECE3D3]"

function PeopleTable({ m }: { m: NumberMonth }) {
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={TH}>Persona</th>
          <th className={TH}>Teléfono</th>
          <th className={`${TH} text-center`}>Llamadas</th>
          <th className={TH}>Estado en el CRM</th>
        </tr>
      </thead>
      <tbody>
        {m.people.map((p) => (
          <tr key={p.phone} className={p.internal ? "text-[#93A39D]" : ""}>
            <td className={TD}>
              {p.name || "(sin nombre)"}
              {p.internal && <span className="ml-2 text-[10px] uppercase tracking-wide">equipo, no es cliente</span>}
            </td>
            <td className={TD}>{formatPhone(p.phone)}</td>
            <td className={`${TD} text-center`}>{p.calls}</td>
            <td className={TD}>{p.status ? STATUS[p.status] ?? p.status : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ReportView({ report, from, to }: { report: CallReport; from: string; to: string }) {
  if (report.numbers.length === 0) {
    return (
      <p className="text-sm text-[#93A39D] py-10 text-center">
        No hay llamadas entrantes entre {from} y {to} para los números elegidos.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      {!report.retell.ok && report.retell.reason !== "n/a" && (
        <div className="rounded-xl border border-[#E8D28A] bg-[#FFF8E1] px-4 py-3 text-sm text-[#7a5b00]">
          No se pudo cruzar con Retell ({report.retell.reason}). Las tablas de &quot;colgaron antes&quot; se muestran sin ese dato.
        </div>
      )}

      {report.numbers.map((n) => (
        <section key={n.number} className="space-y-4 break-inside-avoid-page">
          <div>
            <h2 className="font-display text-xl font-semibold text-[#20342C]">{n.label}</h2>
            <p className="text-xs text-[#93A39D]">{formatPhone(n.number)}</p>
          </div>

          <div className="bg-card border border-[#ECE3D3] rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>Mes</th>
                  <th className={`${TH} text-center`}>Llamadas</th>
                  <th className={`${TH} text-center`}>Contestadas</th>
                  <th className={`${TH} text-center`}>Colgaron antes</th>
                  <th className={`${TH} text-center`}>Personas</th>
                  <th className={`${TH} text-center`}>Duración promedio</th>
                </tr>
              </thead>
              <tbody>
                {n.months.map((m) => (
                  <tr key={m.month}>
                    <td className={TD}>{monthLabel(m.month)}</td>
                    <td className={`${TD} text-center font-semibold`}>{m.summary.calls}</td>
                    <td className={`${TD} text-center`}>{m.summary.answered}</td>
                    <td className={`${TD} text-center`}>{m.summary.hungUp}</td>
                    <td className={`${TD} text-center`}>
                      {m.summary.people}
                      {m.summary.internalPhones > 0 && (
                        <span className="text-[#93A39D]"> (+{m.summary.internalPhones} del equipo)</span>
                      )}
                    </td>
                    <td className={`${TD} text-center`}>{fmtDuration(m.summary.avgAnsweredSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {n.months.map((m) => (
            <div key={m.month} className="space-y-3">
              <h3 className="text-sm font-semibold text-[#20342C]">
                {monthLabel(m.month)} — {m.summary.people} personas · {m.summary.calls} llamadas
              </h3>
              <div className="bg-card border border-[#ECE3D3] rounded-2xl overflow-hidden">
                <PeopleTable m={m} />
              </div>

              {m.hungUp.length > 0 && (
                <div className="bg-card border border-[#ECE3D3] rounded-2xl overflow-hidden">
                  <p className="px-3 pt-3 text-xs font-semibold text-[#20342C]">
                    Llamadas que colgaron antes de que contestaran ({m.hungUp.length})
                  </p>
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className={TH}>Cuándo</th>
                        <th className={TH}>Persona</th>
                        <th className={TH}>Teléfono</th>
                        {report.retell.ok && <th className={TH}>Qué pasó</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {m.hungUp.map((h, i) => (
                        <tr key={`${h.atIso}-${i}`}>
                          <td className={TD}>{fmtWhen(h.atIso)}</td>
                          <td className={TD}>{h.name || "(sin nombre)"}</td>
                          <td className={TD}>{formatPhone(h.phone)}</td>
                          {report.retell.ok && <td className={TD}>{h.kind ? KIND[h.kind] : "—"}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </section>
      ))}

      <p className="text-[11px] text-[#93A39D] leading-relaxed">
        Contestada = alguien de la clínica habló con el cliente. Colgaron antes = el cliente colgó antes de que
        contestaran. Persona = teléfono distinto; los teléfonos del equipo no cuentan. El cruce con Retell es por hora
        (Retell no guarda el teléfono del cliente), así que es aproximado. Horas en hora de California.
      </p>
    </div>
  )
}
