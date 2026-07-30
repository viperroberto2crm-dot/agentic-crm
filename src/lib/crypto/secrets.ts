import "server-only"
import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

/**
 * Cifrado simétrico para credenciales de terceros guardadas en la base
 * (connection_credentials). AES-256-GCM: confidencialidad + integridad (el tag
 * detecta manipulación). La llave maestra vive SOLO en Vercel env
 * (CONNECTIONS_ENC_KEY) — nunca en la base ni en el cliente.
 *
 * Formato del blob (base64): [ iv(12) | authTag(16) | ciphertext ].
 */

function getKey(): Buffer {
  const raw = process.env.CONNECTIONS_ENC_KEY?.trim()
  if (!raw) throw new Error("CONNECTIONS_ENC_KEY no está configurada")
  // Aceptamos 64 hex chars (32 bytes) o base64 de 32 bytes.
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64")
  if (buf.length !== 32) {
    throw new Error("CONNECTIONS_ENC_KEY debe ser de 32 bytes (64 hex o base64)")
  }
  return buf
}

/** true si la llave maestra está bien configurada (para gate en la UI). */
export function isEncryptionConfigured(): boolean {
  try {
    getKey()
    return true
  } catch {
    return false
  }
}

/**
 * `aad` (opcional) ata el blob a su contexto (ej. "twilio:auth_token"): un blob
 * cifrado para un slot NO descifra en otro aunque alguien lo copie en la base
 * (Fable #1). Debe coincidir en cifrar y descifrar.
 */
export function encryptSecret(plaintext: string, aad?: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"))
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString("base64")
}

export function decryptSecret(blob: string, aad?: string): string {
  const key = getKey()
  const raw = Buffer.from(blob, "base64")
  if (raw.length < 28) throw new Error("blob cifrado inválido")
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ct = raw.subarray(28)
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
}
