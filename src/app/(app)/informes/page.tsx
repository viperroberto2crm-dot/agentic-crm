import Link from "next/link"
import { loadReportForRequest } from "@/lib/reports/load-for-request"
import { ReportView, formatPhone } from "./_components/report-view"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export default async function InformesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const { report, from, to, selected } = await loadReportForRequest(sp)

  const qs = new URLSearchParams({ from, to })
  for (const n of selected) qs.append("n", n)
  const printHref = `/informes-imprimir?${qs.toString()}&auto=1`

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[#20342C]">Informes de llamadas</h1>
          <p className="text-xs text-[#93A39D] mt-1">
            Llamadas entrantes por número de tracking y por mes, con las personas que llamaron.
          </p>
        </div>
        <Link
          href={printHref}
          target="_blank"
          className="inline-flex items-center rounded-xl bg-[#20342C] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Descargar PDF
        </Link>
      </div>

      <form method="get" className="bg-card border border-[#ECE3D3] rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-[#93A39D] space-y-1">
            <span className="block uppercase tracking-widest font-semibold text-[10px]">Desde</span>
            <input type="date" name="from" defaultValue={from} className="rounded-lg border border-[#ECE3D3] px-2 py-1.5 text-sm text-[#20342C]" />
          </label>
          <label className="text-xs text-[#93A39D] space-y-1">
            <span className="block uppercase tracking-widest font-semibold text-[10px]">Hasta</span>
            <input type="date" name="to" defaultValue={to} className="rounded-lg border border-[#ECE3D3] px-2 py-1.5 text-sm text-[#20342C]" />
          </label>
          <button type="submit" className="rounded-xl bg-[#20342C] px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            Ver informe
          </button>
        </div>
        {report.available.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="text-[10px] uppercase tracking-widest font-semibold text-[#93A39D]">
              Números (sin marcar = todos)
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {report.available.map((a) => (
                <label key={a.number} className="flex items-center gap-1.5 text-sm text-[#20342C]">
                  <input type="checkbox" name="n" value={a.number} defaultChecked={selected.includes(a.number)} />
                  {a.label} <span className="text-[#93A39D]">{formatPhone(a.number)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </form>

      <ReportView report={report} from={from} to={to} />
    </div>
  )
}
