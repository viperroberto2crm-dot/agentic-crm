"use client"

import { useMemo, useState, useEffect } from "react"
import { Check, AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  validatePhone,
  formatPhoneAsYouType,
} from "@/lib/utils/phone"

type Props = {
  name?: string
  value: string
  onChange: (next: string) => void
  required?: boolean
  placeholder?: string
  className?: string
  /** ISO 3166 default country, ej. "US", "MX". Default "US". */
  defaultCountry?: "US" | "MX" | string
  /** Si true, muestra feedback visual (icono + mensaje). Default true. */
  showFeedback?: boolean
}

/**
 * Input controlado para teléfonos con formato y validación en tiempo real.
 *
 * - Mientras el user escribe: formatea "as-you-type" sin forzar.
 * - Al perder foco: si es válido, normaliza a formato internacional.
 * - Muestra ícono verde (válido), ámbar (inválido), o nada (vacío).
 * - El padre recibe siempre el string del input (no E.164). Para guardar
 *   en DB en formato canónico, llamar validatePhone(value).e164 al submit.
 */
export function PhoneInput({
  name,
  value,
  onChange,
  required,
  placeholder,
  className,
  defaultCountry = "US",
  showFeedback = true,
}: Props) {
  const [touched, setTouched] = useState(false)

  // No formateamos as-you-type si el usuario está borrando, para no
  // pelear con el cursor. Detectamos por longitud comparativa.
  const [prevLen, setPrevLen] = useState(value.length)

  const validation = useMemo(
    () => validatePhone(value, defaultCountry as never),
    [value, defaultCountry],
  )

  useEffect(() => {
    setPrevLen(value.length)
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    const isDeleting = next.length < prevLen
    if (isDeleting) {
      onChange(next)
      return
    }
    const formatted = formatPhoneAsYouType(next, defaultCountry as never)
    onChange(formatted)
  }

  function handleBlur() {
    setTouched(true)
    if (validation.valid && validation.formatted) {
      onChange(validation.formatted)
    }
  }

  const showError = touched && !!value && !validation.valid
  const showValid = touched && validation.valid

  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          name={name}
          type="tel"
          inputMode="tel"
          required={required}
          placeholder={placeholder ?? "+1 (555) 123-4567"}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          className={`${className ?? ""} ${
            showError ? "border-amber-400 focus-visible:ring-amber-300" : ""
          } ${showValid ? "border-emerald-400/60" : ""} pr-8`}
        />
        {showFeedback && showValid && (
          <Check className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
        )}
        {showFeedback && showError && (
          <AlertTriangle className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500" />
        )}
      </div>
      {showFeedback && showError && validation.message && (
        <p className="text-[11px] text-amber-600">{validation.message}</p>
      )}
    </div>
  )
}
