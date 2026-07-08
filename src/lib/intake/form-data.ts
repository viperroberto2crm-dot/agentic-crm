import type {
  IntakeValues,
  IntakeGender,
  IntakeMaritalStatus,
  IntakePreferredLanguage,
} from "./submit"

// Whitelists para validar los enums que llegan por FormData (tablet pública).
const GENDERS: IntakeGender[] = ["F", "M", "other"]
const MARITAL: IntakeMaritalStatus[] = ["casado", "soltero", "divorciado", "viudo", "otro"]
const LANGS: IntakePreferredLanguage[] = ["en", "es"]

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key)
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function enumOf<T extends string>(fd: FormData, key: string, allowed: T[]): T | null {
  const v = str(fd, key)
  return v && (allowed as string[]).includes(v) ? (v as T) : null
}

/**
 * Extrae y normaliza los valores de intake desde un FormData. Comparte parsing
 * entre el server action público y el interno. Solo campos demográficos.
 */
export function parseIntakeFormData(fd: FormData): IntakeValues {
  return {
    first_name: str(fd, "first_name") ?? "",
    last_name: str(fd, "last_name"),
    phone: str(fd, "phone") ?? "",
    email: str(fd, "email"),
    address_line1: str(fd, "address_line1"),
    city: str(fd, "city"),
    state: str(fd, "state"),
    zip: str(fd, "zip"),
    dob: str(fd, "dob"),
    gender: enumOf(fd, "gender", GENDERS),
    identifies_as: str(fd, "identifies_as"),
    occupation: str(fd, "occupation"),
    marital_status: enumOf(fd, "marital_status", MARITAL),
    preferred_language: enumOf(fd, "preferred_language", LANGS),
    intake_date: str(fd, "intake_date"),
  }
}
