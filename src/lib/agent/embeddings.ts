/**
 * Cliente de embeddings para OpenAI text-embedding-3-small (1536 dim).
 * Sin SDK — fetch directo para no añadir dependencia.
 */

export class MissingOpenAIKeyError extends Error {
  constructor() {
    super("OPENAI_API_KEY no configurada")
    this.name = "MissingOpenAIKeyError"
  }
}

const MODEL = "text-embedding-3-small"
const MAX_INPUT_CHARS = 8000 // truncate antes de enviar; el modelo acepta ~8k tokens pero limitamos por chars por simplicidad

export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new MissingOpenAIKeyError()

  const input = (text ?? "").slice(0, MAX_INPUT_CHARS)
  if (!input.trim()) return []

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: MODEL, input }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    throw new Error(`OpenAI embeddings error ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = (await res.json()) as { data: Array<{ embedding: number[] }> }
  const vec = data?.data?.[0]?.embedding
  if (!Array.isArray(vec)) throw new Error("OpenAI embeddings: respuesta sin vector")
  return vec
}

export async function embedTextBatch(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new MissingOpenAIKeyError()

  const inputs = texts.map((t) => (t ?? "").slice(0, MAX_INPUT_CHARS)).filter((t) => t.trim().length > 0)
  if (inputs.length === 0) return []

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    throw new Error(`OpenAI embeddings batch error ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = (await res.json()) as { data: Array<{ embedding: number[] }> }
  return (data?.data ?? []).map((d) => d.embedding)
}
