"use client"

import { useState, useTransition } from "react"

// Diccionario bilingüe AUTOCONTENIDO (no depende de next-intl): la tablet
// pública puede renderizar fuera del contexto de locale. Toggle ES/EN propio.
type Lang = "es" | "en"

const DICT = {
  es: {
    heading: "Admisión de paciente",
    sub: "Complete sus datos. Solo información general.",
    firstName: "Nombre",
    lastName: "Apellido",
    phone: "Teléfono",
    email: "Correo electrónico",
    dob: "Fecha de nacimiento",
    gender: "Sexo",
    genderF: "Femenino",
    genderM: "Masculino",
    genderOther: "Otro",
    identifiesAs: "Me identifico como (opcional)",
    occupation: "Ocupación",
    maritalStatus: "Estado civil",
    married: "Casado/a",
    single: "Soltero/a",
    divorced: "Divorciado/a",
    widowed: "Viudo/a",
    otherMarital: "Otro",
    address: "Dirección",
    city: "Ciudad",
    state: "Estado",
    zip: "Código postal",
    preferredLanguage: "Idioma preferido",
    langEs: "Español",
    langEn: "Inglés",
    clinic: "Clínica",
    selectClinic: "Seleccione la clínica",
    submit: "Enviar",
    submitting: "Enviando…",
    requiredMsg: "El nombre y el teléfono son obligatorios.",
    errorMsg: "Ocurrió un error. Intente de nuevo.",
    thankYou: "¡Gracias!",
    thankYouSub: "Su información fue registrada.",
    newPatient: "Nuevo paciente",
    optional: "Opcional",
  },
  en: {
    heading: "Patient intake",
    sub: "Fill in your information. General information only.",
    firstName: "First name",
    lastName: "Last name",
    phone: "Phone",
    email: "Email",
    dob: "Date of birth",
    gender: "Sex",
    genderF: "Female",
    genderM: "Male",
    genderOther: "Other",
    identifiesAs: "I identify as (optional)",
    occupation: "Occupation",
    maritalStatus: "Marital status",
    married: "Married",
    single: "Single",
    divorced: "Divorced",
    widowed: "Widowed",
    otherMarital: "Other",
    address: "Address",
    city: "City",
    state: "State",
    zip: "Zip code",
    preferredLanguage: "Preferred language",
    langEs: "Spanish",
    langEn: "English",
    clinic: "Clinic",
    selectClinic: "Select a clinic",
    submit: "Submit",
    submitting: "Submitting…",
    requiredMsg: "First name and phone are required.",
    errorMsg: "Something went wrong. Please try again.",
    thankYou: "Thank you!",
    thankYouSub: "Your information has been saved.",
    newPatient: "New patient",
    optional: "Optional",
  },
} as const

type GenderVal = "F" | "M" | "other"
type MaritalVal = "casado" | "soltero" | "divorciado" | "viudo" | "otro"

type BrandOption = { slug: string; name: string }

export type IntakeFormProps = {
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  mode: "public" | "internal"
  /** public: marca fija por URL. */
  brandSlug?: string
  brandName?: string
  brandColor?: string | null
  /** internal: marcas seleccionables (elegibles + autorizadas). */
  brands?: BrandOption[]
  defaultLang?: Lang
}

type FormState = {
  first_name: string
  last_name: string
  phone: string
  email: string
  dob: string
  gender: GenderVal | ""
  identifies_as: string
  occupation: string
  marital_status: MaritalVal | ""
  address_line1: string
  city: string
  state: string
  zip: string
  preferred_language: Lang | ""
}

const EMPTY: FormState = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  dob: "",
  gender: "",
  identifies_as: "",
  occupation: "",
  marital_status: "",
  address_line1: "",
  city: "",
  state: "",
  zip: "",
  preferred_language: "",
}

export function IntakeForm({
  action,
  mode,
  brandSlug,
  brandName,
  brandColor,
  brands,
  defaultLang = "es",
}: IntakeFormProps) {
  const [lang, setLang] = useState<Lang>(defaultLang)
  const t = DICT[lang]
  const accent = brandColor || "#0E5F4C"

  const [form, setForm] = useState<FormState>(EMPTY)
  const [selectedBrand, setSelectedBrand] = useState<string>(
    brandSlug ?? (brands && brands.length === 1 ? brands[0].slug : ""),
  )
  const [honeypot, setHoneypot] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [isPending, startTransition] = useTransition()

  const isPublic = mode === "public"

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((p) => ({ ...p, [key]: value }))
  }

  function reset() {
    setForm(EMPTY)
    setHoneypot("")
    setError(null)
    setDone(false)
    if (!brandSlug && brands && brands.length !== 1) setSelectedBrand("")
  }

  function handleSubmit() {
    setError(null)
    const brandForSubmit = brandSlug ?? selectedBrand
    if (!brandForSubmit) {
      setError(t.selectClinic)
      return
    }
    if (!form.first_name.trim() || !form.phone.trim()) {
      setError(t.requiredMsg)
      return
    }

    const fd = new FormData()
    fd.set("brand", brandForSubmit)
    fd.set("company", honeypot) // honeypot
    fd.set("first_name", form.first_name)
    fd.set("last_name", form.last_name)
    fd.set("phone", form.phone)
    fd.set("email", form.email)
    fd.set("dob", form.dob)
    fd.set("gender", form.gender)
    fd.set("identifies_as", form.identifies_as)
    fd.set("occupation", form.occupation)
    fd.set("marital_status", form.marital_status)
    fd.set("address_line1", form.address_line1)
    fd.set("city", form.city)
    fd.set("state", form.state)
    fd.set("zip", form.zip)
    fd.set("preferred_language", form.preferred_language)

    startTransition(async () => {
      try {
        const res = await action(fd)
        if (res.ok) {
          setDone(true)
        } else {
          setError(t.errorMsg)
        }
      } catch {
        setError(t.errorMsg)
      }
    })
  }

  // ── Pantalla de confirmación ────────────────────────────────────────────────
  if (done) {
    return (
      <div className="flex flex-col items-center justify-center text-center gap-6 py-12">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ backgroundColor: `${accent}1A` }}
        >
          <svg
            className="w-10 h-10"
            style={{ color: accent }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div>
          <h2 className="text-3xl font-semibold text-gray-900">{t.thankYou}</h2>
          <p className="mt-2 text-gray-500 text-lg">{t.thankYouSub}</p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="h-14 px-8 rounded-xl text-white text-lg font-semibold transition-opacity hover:opacity-90"
          style={{ backgroundColor: accent }}
        >
          {t.newPatient}
        </button>
      </div>
    )
  }

  const inputCls = isPublic
    ? "w-full h-14 rounded-xl border border-gray-200 bg-white px-4 text-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2"
    : "w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2"

  const labelCls = isPublic
    ? "text-sm font-medium text-gray-600"
    : "text-xs font-medium text-gray-500"

  const ringStyle = { ["--tw-ring-color" as string]: accent } as React.CSSProperties

  function Field({
    label,
    required,
    children,
  }: {
    label: string
    required?: boolean
    children: React.ReactNode
  }) {
    return (
      <div className="space-y-1.5">
        <label className={labelCls}>
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {children}
      </div>
    )
  }

  const Segmented = ({
    options,
    value,
    onChange,
  }: {
    options: { value: string; label: string }[]
    value: string
    onChange: (v: string) => void
  }) => (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(active ? "" : o.value)}
            aria-pressed={active}
            className={[
              "rounded-xl border transition-colors",
              isPublic ? "h-12 px-5 text-base" : "h-9 px-3.5 text-sm",
              active ? "text-white border-transparent" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
            ].join(" ")}
            style={active ? { backgroundColor: accent } : undefined}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )

  const genderOpts = [
    { value: "F", label: t.genderF },
    { value: "M", label: t.genderM },
    { value: "other", label: t.genderOther },
  ]
  const maritalOpts = [
    { value: "casado", label: t.married },
    { value: "soltero", label: t.single },
    { value: "divorciado", label: t.divorced },
    { value: "viudo", label: t.widowed },
    { value: "otro", label: t.otherMarital },
  ]
  const langOpts = [
    { value: "es", label: t.langEs },
    { value: "en", label: t.langEn },
  ]

  return (
    <div className="space-y-6">
      {/* Header + language toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          {brandName && (
            <p className="text-sm font-semibold tracking-wide uppercase" style={{ color: accent }}>
              {brandName}
            </p>
          )}
          <h1 className={isPublic ? "text-3xl font-semibold text-gray-900 mt-1" : "text-xl font-semibold text-gray-900"}>
            {t.heading}
          </h1>
          <p className="text-gray-500 mt-1">{t.sub}</p>
        </div>
        <div className="flex rounded-xl border border-gray-200 overflow-hidden shrink-0">
          {(["es", "en"] as Lang[]).map((l) => {
            const active = lang === l
            return (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={active}
                className={[
                  "px-4 font-semibold transition-colors",
                  isPublic ? "h-11 text-base" : "h-9 text-sm",
                  active ? "text-white" : "bg-white text-gray-600 hover:bg-gray-50",
                ].join(" ")}
                style={active ? { backgroundColor: accent } : undefined}
              >
                {l.toUpperCase()}
              </button>
            )
          })}
        </div>
      </div>

      {/* Brand selector (internal only, when >1 option) */}
      {!brandSlug && brands && (
        <Field label={t.clinic} required>
          <select
            value={selectedBrand}
            onChange={(e) => setSelectedBrand(e.target.value)}
            className={inputCls}
            style={ringStyle}
          >
            <option value="">{t.selectClinic}</option>
            {brands.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className={isPublic ? "grid grid-cols-1 sm:grid-cols-2 gap-4" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>
        <Field label={t.firstName} required>
          <input
            className={inputCls}
            style={ringStyle}
            value={form.first_name}
            onChange={(e) => set("first_name", e.target.value)}
            autoComplete="given-name"
          />
        </Field>
        <Field label={t.lastName}>
          <input
            className={inputCls}
            style={ringStyle}
            value={form.last_name}
            onChange={(e) => set("last_name", e.target.value)}
            autoComplete="family-name"
          />
        </Field>
        <Field label={t.phone} required>
          <input
            className={inputCls}
            style={ringStyle}
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            autoComplete="tel"
          />
        </Field>
        <Field label={t.email}>
          <input
            className={inputCls}
            style={ringStyle}
            type="email"
            inputMode="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            autoComplete="email"
          />
        </Field>
        <Field label={t.dob}>
          <input
            className={inputCls}
            style={ringStyle}
            type="date"
            value={form.dob}
            onChange={(e) => set("dob", e.target.value)}
          />
        </Field>
        <Field label={t.occupation}>
          <input
            className={inputCls}
            style={ringStyle}
            value={form.occupation}
            onChange={(e) => set("occupation", e.target.value)}
          />
        </Field>
      </div>

      <Field label={t.gender}>
        <Segmented options={genderOpts} value={form.gender} onChange={(v) => set("gender", v as GenderVal | "")} />
      </Field>

      <Field label={t.identifiesAs}>
        <input
          className={inputCls}
          style={ringStyle}
          value={form.identifies_as}
          onChange={(e) => set("identifies_as", e.target.value)}
        />
      </Field>

      <Field label={t.maritalStatus}>
        <Segmented
          options={maritalOpts}
          value={form.marital_status}
          onChange={(v) => set("marital_status", v as MaritalVal | "")}
        />
      </Field>

      <Field label={t.address}>
        <input
          className={inputCls}
          style={ringStyle}
          value={form.address_line1}
          onChange={(e) => set("address_line1", e.target.value)}
          autoComplete="address-line1"
        />
      </Field>

      <div className={isPublic ? "grid grid-cols-1 sm:grid-cols-3 gap-4" : "grid grid-cols-1 sm:grid-cols-3 gap-3"}>
        <Field label={t.city}>
          <input
            className={inputCls}
            style={ringStyle}
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            autoComplete="address-level2"
          />
        </Field>
        <Field label={t.state}>
          <input
            className={inputCls}
            style={ringStyle}
            value={form.state}
            onChange={(e) => set("state", e.target.value)}
            autoComplete="address-level1"
          />
        </Field>
        <Field label={t.zip}>
          <input
            className={inputCls}
            style={ringStyle}
            inputMode="numeric"
            value={form.zip}
            onChange={(e) => set("zip", e.target.value)}
            autoComplete="postal-code"
          />
        </Field>
      </div>

      <Field label={t.preferredLanguage}>
        <Segmented
          options={langOpts}
          value={form.preferred_language}
          onChange={(v) => set("preferred_language", v as Lang | "")}
        />
      </Field>

      {/* Honeypot: oculto para humanos, visible para bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden">
        <label>
          Company
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending}
        className={[
          "w-full rounded-xl text-white font-semibold transition-opacity hover:opacity-90 disabled:opacity-60",
          isPublic ? "h-16 text-xl" : "h-11 text-base",
        ].join(" ")}
        style={{ backgroundColor: accent }}
      >
        {isPending ? t.submitting : t.submit}
      </button>
    </div>
  )
}
