"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"

// Landing PÚBLICA de selección de clínica (kiosco/tablet). Sin login.
// La persona toca su clínica y pasa a /intake/[slug]. Bilingüe autocontenido
// (fuera del contexto de next-intl), default español.

export type PickerBrand = {
  slug: string
  name: string
  color: string
}

const DICT = {
  es: {
    title: "Bienvenido",
    subtitle: "Selecciona tu clínica para llenar tu admisión",
    toggle: "EN",
  },
  en: {
    title: "Welcome",
    subtitle: "Select your clinic to fill out your admission",
    toggle: "ES",
  },
} as const

export function ClinicPicker({ brands }: { brands: PickerBrand[] }) {
  const [lang, setLang] = useState<"es" | "en">("es")
  const d = DICT[lang]

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="flex justify-end mb-4">
        <button
          type="button"
          onClick={() => setLang(lang === "es" ? "en" : "es")}
          className="h-9 px-3 rounded-lg border border-black/10 bg-white/70 text-sm font-semibold text-[#5C6F68] hover:text-[#0A4538] hover:bg-white transition-colors"
        >
          {d.toggle}
        </button>
      </div>

      <div className="text-center mb-8">
        <h1 className="font-display text-3xl font-semibold text-[#1A2E28] tracking-tight">
          {d.title}
        </h1>
        <p className="text-[#5C6F68] mt-2 text-base">{d.subtitle}</p>
      </div>

      <div className="space-y-3">
        {brands.map((b) => (
          <Link
            key={b.slug}
            href={`/intake/${b.slug}`}
            className="group flex items-center gap-4 w-full bg-white rounded-2xl border border-black/5 shadow-sm px-5 py-5 hover:shadow-md transition-shadow"
          >
            <span
              className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center"
              style={{ backgroundColor: `${b.color}1a` }}
            >
              <span
                className="w-3.5 h-3.5 rounded-full"
                style={{ backgroundColor: b.color }}
              />
            </span>
            <span className="flex-1 text-lg font-semibold text-[#1A2E28] leading-tight">
              {b.name}
            </span>
            <ChevronRight className="w-6 h-6 text-[#93A39D] group-hover:text-[#0A4538] transition-colors shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  )
}
