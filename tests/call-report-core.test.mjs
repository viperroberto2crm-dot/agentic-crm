// Pruebas de la lógica pura del informe de llamadas por campaña.
// Correr:  node --test tests/
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  classifyCall,
  monthKey,
  summarize,
  listPeople,
  classifyHungUp,
} from "../src/lib/reports/call-report-core.ts"

const TZ = "America/Los_Angeles"
const TEAM = new Set(["+16572320227", "+17149260731"])

const call = (o) => ({
  called_at: "2026-09-10T18:00:00Z",
  dialed_e164: "+17144672002",
  caller_e164: "+17140000001",
  outcome: "connected",
  duration_seconds: 60,
  lead_name: null,
  lead_status: null,
  ...o,
})

// ── clasificar una llamada ───────────────────────────────────────────────────
test("connected y los resultados que pone el CRM cuentan como contestada", () => {
  for (const outcome of ["connected", "appointment_set", "callback_requested", "not_interested", "wrong_number"]) {
    assert.equal(classifyCall({ outcome }), "answered", outcome)
  }
})

test("sin resultado o no_answer cuenta como colgó antes, aunque tenga segundos de timbre", () => {
  // En GLP hay llamadas con outcome null y 4–22 s: el cliente colgó mientras sonaba.
  assert.equal(classifyCall({ outcome: null, duration_seconds: 22 }), "hung_up")
  assert.equal(classifyCall({ outcome: null, duration_seconds: null }), "hung_up")
  assert.equal(classifyCall({ outcome: "no_answer", duration_seconds: 0 }), "hung_up")
})

// ── mes en hora de California ───────────────────────────────────────────────
test("el mes se corta en hora de California, no en UTC", () => {
  assert.equal(monthKey("2026-10-01T06:30:00Z", TZ), "2026-09") // 30-sep 11:30 pm PDT
  assert.equal(monthKey("2026-10-01T07:00:00Z", TZ), "2026-10") // 1-oct 12:00 am PDT
})

// ── resumen por número y mes ────────────────────────────────────────────────
test("resume llamadas, contestadas, colgaron, personas y duración por número y mes", () => {
  const rows = [
    call({ caller_e164: "+17140000001" }),
    call({ caller_e164: "+17140000001", called_at: "2026-09-11T18:00:00Z", duration_seconds: 120 }),
    call({ caller_e164: "+17140000002", outcome: null, duration_seconds: null }),
    call({ caller_e164: "+17140000003", called_at: "2026-10-02T18:00:00Z" }),
    call({ dialed_e164: "+18888808743", caller_e164: "+17140000004", called_at: "2026-09-12T18:00:00Z" }),
  ]
  const out = summarize(rows, { timeZone: TZ, teamPhones: TEAM })
  const botoxSep = out.find((r) => r.number === "+17144672002" && r.month === "2026-09")
  assert.deepEqual(
    { c: botoxSep.calls, a: botoxSep.answered, h: botoxSep.hungUp, p: botoxSep.people, avg: botoxSep.avgAnsweredSeconds },
    { c: 3, a: 2, h: 1, p: 2 + 0 + 0 + 1 - 1, avg: 90 },
  )
  assert.equal(out.length, 3) // botox sep, botox oct, iv sep
  assert.deepEqual(out.map((r) => `${r.number}|${r.month}`), [
    "+17144672002|2026-09",
    "+17144672002|2026-10",
    "+18888808743|2026-09",
  ])
})

test("los teléfonos del equipo no cuentan como personas pero se cuentan aparte", () => {
  const rows = [
    call({ caller_e164: "+16572320227" }), // línea de La Esperanza
    call({ caller_e164: "+17149260731" }), // prueba de Roberto
    call({ caller_e164: "+17140000009" }), // cliente real
  ]
  const [s] = summarize(rows, { timeZone: TZ, teamPhones: TEAM })
  assert.equal(s.calls, 3)
  assert.equal(s.people, 1)
  assert.equal(s.internalPhones, 2)
})

// ── lista de personas ───────────────────────────────────────────────────────
test("lista las personas por teléfono con llamadas, contestadas, estado y marca de equipo", () => {
  const rows = [
    call({ caller_e164: "+17140000001", lead_name: "Ana", lead_status: "new" }),
    call({ caller_e164: "+17140000001", lead_name: "Ana", lead_status: "new", outcome: null }),
    call({ caller_e164: "+16572320227", lead_name: "Samuel Nambo", lead_status: "new" }),
  ]
  const people = listPeople(rows, { teamPhones: TEAM })
  assert.equal(people.length, 2)
  const ana = people.find((p) => p.phone === "+17140000001")
  assert.deepEqual(
    { n: ana.calls, a: ana.answered, s: ana.status, i: ana.internal, name: ana.name },
    { n: 2, a: 1, s: "new", i: false, name: "Ana" },
  )
  assert.equal(people.find((p) => p.phone === "+16572320227").internal, true)
})

// ── cruce con Retell ────────────────────────────────────────────────────────
const t0 = Date.parse("2026-09-19T16:44:00Z")
const WIN = { windowMs: 6 * 60 * 1000, minTalkSeconds: 10 }

test("sin ninguna llamada en Retell en la ventana → nunca llegó al agente", () => {
  assert.equal(classifyHungUp(t0, [], WIN), "never_reached")
  const lejos = [{ startMs: t0 + 30 * 60 * 1000, durationSeconds: 120 }]
  assert.equal(classifyHungUp(t0, lejos, WIN), "never_reached")
})

test("llamada larga en Retell poco después → colgó, volvió a llamar y habló", () => {
  const r = [{ startMs: t0 + 80 * 1000, durationSeconds: 309 }]
  assert.equal(classifyHungUp(t0, r, WIN), "redialed_talked")
})

test("llamada de 1 segundo en Retell → llegó al agente pero colgó", () => {
  const r = [{ startMs: t0 + 20 * 1000, durationSeconds: 1 }]
  assert.equal(classifyHungUp(t0, r, WIN), "reached_hung_up")
})

// ── cruce mejorado: re-llamada del mismo teléfono y Retell sin doble conteo ─────
import { hungUpOutcome, consumeAnswered } from "../src/lib/reports/call-report-core.ts"

test("si el mismo teléfono volvió a llamar y contestaron, es 'volvió a llamar y habló' aunque no haya datos de Retell", () => {
  assert.equal(hungUpOutcome(t0, true, [], WIN), "redialed_talked")
})

test("sin re-llamada, una llamada corta en Retell cercana → llegó al agente y colgó", () => {
  const r = [{ startMs: t0 + 15 * 1000, durationSeconds: 1 }]
  assert.equal(hungUpOutcome(t0, false, r, WIN), "reached_hung_up")
})

test("sin re-llamada y sin nada en Retell → nunca llegó al agente", () => {
  assert.equal(hungUpOutcome(t0, false, [], WIN), "never_reached")
})

test("una llamada de Retell que ya corresponde a una llamada contestada no se reutiliza para una que colgó", () => {
  const answeredAt = [t0 + 90 * 1000]
  const retell = [
    { startMs: t0 + 80 * 1000, durationSeconds: 309 }, // es la contestada
    { startMs: t0 + 40 * 1000, durationSeconds: 2 }, // sobra
  ]
  const left = consumeAnswered(answeredAt, retell)
  assert.deepEqual(left, [{ startMs: t0 + 40 * 1000, durationSeconds: 2 }])
})

// ── duración promedio: solo si hay datos suficientes ────────────────────────────
test("la duración promedio se oculta si menos de la mitad de las contestadas tiene duración guardada", () => {
  const rows = [
    call({ caller_e164: "+17140000011", duration_seconds: 100 }),
    call({ caller_e164: "+17140000012", duration_seconds: null }),
    call({ caller_e164: "+17140000013", duration_seconds: null }),
    call({ caller_e164: "+17140000014", duration_seconds: null }),
  ]
  const [s] = summarize(rows, { timeZone: TZ, teamPhones: TEAM })
  assert.equal(s.answered, 4)
  assert.equal(s.avgAnsweredSeconds, null)
})

test("la duración promedio se muestra si al menos la mitad de las contestadas tiene duración", () => {
  const rows = [
    call({ caller_e164: "+17140000021", duration_seconds: 100 }),
    call({ caller_e164: "+17140000022", duration_seconds: 50 }),
    call({ caller_e164: "+17140000023", duration_seconds: null }),
    call({ caller_e164: "+17140000024", duration_seconds: null }),
  ]
  const [s] = summarize(rows, { timeZone: TZ, teamPhones: TEAM })
  assert.equal(s.avgAnsweredSeconds, 75)
})
