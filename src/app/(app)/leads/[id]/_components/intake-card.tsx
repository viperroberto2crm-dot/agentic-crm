"use client"

import { useTranslations } from "next-intl"
import { ClipboardList } from "lucide-react"
import type { IntakeData } from "./intake-data"

// Card de solo lectura: muestra los datos demográficos capturados en la
// admisión en clínica (leads.custom_fields). NO muestra datos médicos/PHI.
// El tipo IntakeData y el extractor extractIntakeData viven en ./intake-data
// (archivo NO-cliente) porque el server component los usa.

export function IntakeCard({ data }: { data: IntakeData }) {
  const t = useTranslations("intake")

  const genderLabel: Record<string, string> = {
    F: t("genderF"),
    M: t("genderM"),
    other: t("genderOther"),
  }
  const maritalLabel: Record<string, string> = {
    casado: t("married"),
    soltero: t("single"),
    divorciado: t("divorced"),
    viudo: t("widowed"),
    otro: t("otherMarital"),
  }
  const langLabel: Record<string, string> = {
    es: t("langEs"),
    en: t("langEn"),
  }

  const rows: { label: string; value: string }[] = []
  if (data.dob) rows.push({ label: t("dob"), value: data.dob })
  if (data.gender) rows.push({ label: t("gender"), value: genderLabel[data.gender] ?? data.gender })
  if (data.identifies_as) rows.push({ label: t("identifiesAs"), value: data.identifies_as })
  if (data.occupation) rows.push({ label: t("occupation"), value: data.occupation })
  if (data.marital_status)
    rows.push({ label: t("maritalStatus"), value: maritalLabel[data.marital_status] ?? data.marital_status })
  if (data.preferred_language)
    rows.push({
      label: t("preferredLanguage"),
      value: langLabel[data.preferred_language] ?? data.preferred_language,
    })

  if (rows.length === 0) return null

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold flex items-center gap-1.5">
        <ClipboardList className="w-3.5 h-3.5" /> {t("sectionTitle")}
      </p>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between items-baseline gap-3 py-1 border-b border-[#F2EFE9] last:border-0 sm:last:border-b">
            <dt className="text-xs text-muted-foreground shrink-0">{r.label}</dt>
            <dd className="text-sm text-gray-700 text-right">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
