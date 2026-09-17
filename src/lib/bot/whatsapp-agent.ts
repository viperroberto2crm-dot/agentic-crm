import "server-only"
import Anthropic from "@anthropic-ai/sdk"

/**
 * El bot de texto de WhatsApp. Su trabajo es UNO y muy acotado: sacar el nombre,
 * qué necesita la persona, y el permiso para llamarle. Nada más.
 *
 * Lo que NO hace, y está prohibido en el prompt: hablar de dosis, de
 * medicamentos, de diagnóstico, prometer resultados o que le van a aprobar una
 * receta, y cotizar. El precio y el proceso los explica Valeria en la llamada,
 * que es una persona… bueno, un agente de voz, pero con guion aprobado y con la
 * clínica detrás. Este bot de texto solo abre la puerta.
 *
 * El texto del CONSENTIMIENTO no lo escribe el modelo: lo manda el servidor
 * (ver `CONSENT_PROMPT`). Un permiso legal no puede depender de cómo se le haya
 * ocurrido redactarlo a un LLM esa vez.
 */

const MODEL = process.env.WHATSAPP_BOT_MODEL?.trim() || "claude-sonnet-5"

/** Techo duro por respuesta: WhatsApp es de mensajes cortos y esto acota el costo. */
const MAX_TOKENS = 400

/**
 * [CONFIRMAR con Horizon] Texto EXACTO de la pregunta de consentimiento.
 *
 * No es un "¿te podemos llamar?". Para que un sí sirva como consentimiento
 * previo, tiene que quedar dicho: (a) que quien llama es un asistente
 * automatizado, (b) a qué número, y (c) que aceptar no es condición para
 * comprar nada. Si Horizon cambia este texto, se cambia AQUÍ y queda guardado
 * tal cual en cada fila de `call_consents`.
 *
 * `{{telefono}}` lo sustituye el servidor con el número al que se va a llamar.
 */
export const CONSENT_PROMPT =
  "Para ayudarte mejor, una asistente automatizada de nuestra clínica puede " +
  "llamarte al {{telefono}} para resolver tus dudas y, si quieres, agendar. " +
  "La llamada es con una voz automatizada. Aceptar no es requisito para comprar " +
  "nada y puedes decir que no en cualquier momento.\n\n" +
  "¿Nos das permiso de llamarte a ese número? Responde SÍ o NO."

const SYSTEM = `Eres el asistente automatizado de atención por WhatsApp de una clínica de bienestar en California que atiende a la comunidad hispana de Estados Unidos.

La persona que te escribe acaba de hacer clic en un anuncio. Tu ÚNICO trabajo es:
1. Saludar e identificarte como asistente automatizado (solo en tu primer mensaje).
2. Conseguir su NOMBRE.
3. Entender QUÉ NECESITA, en sus propias palabras.
4. Conseguir PERMISO para que le llamen.

Nada más. No eres quien resuelve dudas ni quien vende.

REGLAS QUE NO PUEDES ROMPER:
- Escribe en español sencillo y cálido, de tú. Máximo 2 frases por mensaje. Es WhatsApp, no un correo.
- Una sola pregunta por mensaje.
- NUNCA hables de dosis, cantidades, ni nombres de medicamentos de receta.
- NUNCA des diagnóstico, consejo médico, ni opines sobre si algo le sirve a esa persona.
- NUNCA prometas resultados (ni kilos, ni tiempos, ni "vas a lograr").
- NUNCA digas ni insinúes que le van a aprobar una receta o un tratamiento.
- NUNCA des precios, planes ni cómo es el proceso. Si preguntan: "eso te lo explica con detalle la asesora en la llamada".
- No inventes nada de la clínica: horarios, ubicaciones, quién atiende, qué ofrece.
- Si la persona escribe algo delicado (una urgencia médica, dolor fuerte, algo de salud mental), no lo manejes: dile que llame al 911 si es una emergencia y que una persona la va a contactar.

CÓMO USAR TUS HERRAMIENTAS:
- En cuanto sepas el nombre o qué necesita, llama a "guardar_datos_del_lead". Puedes llamarla varias veces conforme te vayan diciendo cosas.
- Cuando YA tengas el nombre Y qué necesita, llama a "pedir_permiso_para_llamar". No escribas tú la pregunta del permiso: la manda el sistema con el texto legal exacto. Después de llamar a esa herramienta, NO agregues texto propio.
- Si el sistema te dice que la persona ya recibió la pregunta del permiso, tu única tarea es interpretar su respuesta y llamar a "registrar_respuesta_de_permiso" con acepta=true o acepta=false. Si la respuesta es ambigua ("tal vez", "¿para qué?"), NO llames la herramienta: pide que conteste SÍ o NO.
- Si te piden que les llamen a otro número, guárdalo con "guardar_datos_del_lead" en telefono_para_llamar antes de pedir el permiso.

Después de que la persona acepta, despídete en una frase diciendo que la asesora le marca en unos minutos. No prometas hora exacta.`

export type BotTool =
  | { name: "guardar_datos_del_lead"; input: { nombre?: string; necesidad?: string; telefono_para_llamar?: string; horario_pref?: string } }
  | { name: "pedir_permiso_para_llamar"; input: Record<string, never> }
  | { name: "registrar_respuesta_de_permiso"; input: { acepta: boolean } }

export type BotTurn = { role: "user" | "assistant"; content: string }

export type BotDecision = {
  /** Texto que el bot quiere mandar (vacío si solo llamó herramientas). */
  reply: string
  tools: BotTool[]
  tokensIn: number
  tokensOut: number
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "guardar_datos_del_lead",
    description:
      "Guarda lo que la persona ya dijo. Llámala en cuanto tengas un dato nuevo, sin esperar a tenerlos todos.",
    input_schema: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Cómo se llama la persona." },
        necesidad: { type: "string", description: "Qué necesita, en sus propias palabras." },
        telefono_para_llamar: {
          type: "string",
          description: "Solo si pidió que le llamen a un número DISTINTO al de este chat.",
        },
        horario_pref: { type: "string", description: "A qué hora prefiere que le llamen, si lo dijo." },
      },
    },
  },
  {
    name: "pedir_permiso_para_llamar",
    description:
      "Pide el permiso para llamar. El sistema manda el texto legal exacto; tú no escribes esa pregunta. Úsala solo cuando ya tengas nombre y qué necesita.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "registrar_respuesta_de_permiso",
    description:
      "Interpreta la respuesta de la persona a la pregunta del permiso. Solo cuando la respuesta sea clara.",
    input_schema: {
      type: "object",
      properties: {
        acepta: { type: "boolean", description: "true si dio permiso, false si lo negó." },
      },
      required: ["acepta"],
    },
  },
]

/**
 * Una vuelta del bot. Recibe el historial y el estado, devuelve qué contestar y
 * qué herramientas quiere usar. NO toca la base ni manda nada: de eso se encarga
 * el runner, que es quien tiene los guards.
 */
export async function runBotTurn(args: {
  history: BotTurn[]
  /** Lo que ya se recabó, para que no vuelva a preguntar lo mismo. */
  collected: Record<string, unknown>
  /** true si ya se le mandó la pregunta del permiso y falta su respuesta. */
  awaitingConsent: boolean
}): Promise<BotDecision> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY")

  const anthropic = new Anthropic({ apiKey })

  const estado = [
    `Datos que YA tienes: ${JSON.stringify(args.collected)}`,
    args.awaitingConsent
      ? "IMPORTANTE: a esta persona YA se le mandó la pregunta del permiso. Solo interpreta su respuesta."
      : "Todavía no se le ha pedido el permiso.",
  ].join("\n")

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: `${SYSTEM}\n\n--- ESTADO DE ESTA CONVERSACIÓN ---\n${estado}`,
    tools: TOOLS,
    messages: args.history.map((t) => ({ role: t.role, content: t.content })),
  })

  const reply = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim()

  const tools: BotTool[] = []
  for (const b of resp.content) {
    if (b.type !== "tool_use") continue
    const input = (b.input ?? {}) as Record<string, unknown>
    if (b.name === "guardar_datos_del_lead") {
      tools.push({
        name: "guardar_datos_del_lead",
        input: {
          nombre: typeof input.nombre === "string" ? input.nombre : undefined,
          necesidad: typeof input.necesidad === "string" ? input.necesidad : undefined,
          telefono_para_llamar:
            typeof input.telefono_para_llamar === "string" ? input.telefono_para_llamar : undefined,
          horario_pref: typeof input.horario_pref === "string" ? input.horario_pref : undefined,
        },
      })
    } else if (b.name === "pedir_permiso_para_llamar") {
      tools.push({ name: "pedir_permiso_para_llamar", input: {} })
    } else if (b.name === "registrar_respuesta_de_permiso") {
      tools.push({
        name: "registrar_respuesta_de_permiso",
        input: { acepta: input.acepta === true },
      })
    }
  }

  return {
    reply,
    tools,
    tokensIn: resp.usage?.input_tokens ?? 0,
    tokensOut: resp.usage?.output_tokens ?? 0,
  }
}
