// Verificación manual (no es parte de `node --test`): pasa llamadas reales ya
// exportadas por el CRM por el código del informe y las compara con las cifras
// del informe armado a mano desde 800.com.
//   node tests/verify-live-oracle.mjs <ruta-a-rows.txt>
import fs from "node:fs"
import { summarize, classifyCall, hungUpOutcome, consumeAnswered } from "../src/lib/reports/call-report-core.ts"

const NUM = { B: "+17144672002", I: "+18888808743", G: "+18882073743" }
const OUT = { c: "connected", a: "appointment_set", k: "callback_requested", i: "not_interested", w: "wrong_number", N: "no_answer", v: "voicemail", 0: null }
const TEAM = new Set(["+16572320227", "+15622983012", "+15625100684", "+14243705408", "+13236808475", "+13108776885", "+17149260731"])

const rows = fs
  .readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .map((l) => {
    const [t, n, caller, o, dur] = l.split("|")
    return { called_at: t + "Z", dialed_e164: NUM[n], caller_e164: "+1" + caller, outcome: OUT[o], duration_seconds: dur === "" ? null : Number(dur) }
  })

const got = summarize(rows, { timeZone: "America/Los_Angeles", teamPhones: TEAM })
const expect = {
  "+17144672002|2026-09": [21, 17, 4, 17],
  "+17144672002|2026-10": [18, 14, 4, 9], // 11 teléfonos − 2 internos
  "+18888808743|2026-09": [29, 28, 1, 22],
  "+18888808743|2026-10": [3, 3, 0, 2],
  "+18882073743|2026-09": [15, 11, 4, 13],
  "+18882073743|2026-10": [5, 5, 0, 3],
}
let bad = 0
for (const g of got) {
  const k = `${g.number}|${g.month}`
  const e = expect[k]
  const a = [g.calls, g.answered, g.hungUp, g.people]
  const ok = e && e.every((v, i) => v === a[i])
  if (!ok) bad++
  console.log(ok ? "OK  " : "FAIL", k, "got", a.join("/"), "expected", e?.join("/"), `(+${g.internalPhones} equipo)`)
}
console.log("filas:", rows.length, "grupos:", got.length, "esperados:", Object.keys(expect).length)

// Septiembre: cruce de las 9 que colgaron, sin datos de Retell (solo re-llamada del mismo teléfono)
const sep = rows.filter((r) => r.called_at.startsWith("2026-09") && classifyCall(r) === "hung_up")
const kinds = {}
for (const c of sep) {
  const at = Date.parse(c.called_at)
  const redialed = rows.some(
    (o) => o !== c && o.dialed_e164 === c.dialed_e164 && o.caller_e164 === c.caller_e164 && classifyCall(o) === "answered" && Date.parse(o.called_at) > at && Date.parse(o.called_at) - at <= 600000,
  )
  const k = hungUpOutcome(at, redialed, [], { windowMs: 360000, minTalkSeconds: 10 })
  kinds[k] = (kinds[k] ?? 0) + 1
}
console.log("septiembre colgaron:", sep.length, kinds)
if (bad) process.exit(1)
