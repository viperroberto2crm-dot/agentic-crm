import { loadReportForRequest } from "@/lib/reports/load-for-request"
import { ReportView } from "@/app/(app)/informes/_components/report-view"
import { PrintControls } from "./print-controls"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Versión imprimible del informe (sin menú lateral). Usa el mismo control de
 * acceso que /informes: solo admin y manager, marca validada contra user_brands.
 */
export default async function InformesImprimirPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const { report, from, to } = await loadReportForRequest(sp)
  const auto = (Array.isArray(sp.auto) ? sp.auto[0] : sp.auto) === "1"

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6 bg-white text-[#20342C]">
      <style>{`@page{size:Letter;margin:14mm}@media print{.no-print{display:none!important}body{background:#fff}}`}</style>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] tracking-[0.12em] font-bold text-[#B8943A]">HORIZON · INFORME DE LLAMADAS</p>
          <h1 className="font-display text-3xl font-semibold">Llamadas por campaña</h1>
          <p className="text-sm text-[#93A39D]">
            Del {from} al {to}
          </p>
        </div>
        <PrintControls auto={auto} />
      </header>
      <ReportView report={report} from={from} to={to} />
    </main>
  )
}
