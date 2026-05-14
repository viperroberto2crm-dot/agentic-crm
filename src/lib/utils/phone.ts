import {
  parsePhoneNumberFromString,
  AsYouType,
  type CountryCode,
} from "libphonenumber-js"

export type PhoneValidation = {
  valid: boolean
  formatted: string         // formato "amigable" para mostrar
  e164: string | null       // formato canónico para guardar (+1XXXXXXXXXX)
  country: CountryCode | null
  message: string | null    // mensaje de error si inválido
}

const DEFAULT_COUNTRY: CountryCode = "US"

export function validatePhone(
  input: string | null | undefined,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): PhoneValidation {
  const raw = (input ?? "").trim()

  if (!raw) {
    return {
      valid: false,
      formatted: "",
      e164: null,
      country: null,
      message: null, // vacío no es error, solo "incompleto"
    }
  }

  const phone = parsePhoneNumberFromString(raw, defaultCountry)

  if (!phone) {
    return {
      valid: false,
      formatted: raw,
      e164: null,
      country: null,
      message: "Número no reconocido",
    }
  }

  if (!phone.isValid()) {
    return {
      valid: false,
      formatted: phone.formatInternational(),
      e164: null,
      country: phone.country ?? null,
      message: "Número con formato inválido para el país detectado",
    }
  }

  return {
    valid: true,
    formatted: phone.formatInternational(),
    e164: phone.number,
    country: phone.country ?? null,
    message: null,
  }
}

/**
 * Formateo "as-you-type" para usar onChange del input. Devuelve el string
 * que el usuario ve mientras escribe (no fuerza el formato si todavía es parcial).
 */
export function formatPhoneAsYouType(
  input: string,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): string {
  if (!input) return ""
  const formatter = new AsYouType(defaultCountry)
  return formatter.input(input)
}
