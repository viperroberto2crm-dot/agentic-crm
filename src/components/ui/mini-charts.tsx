// Mini-gráficas compartidas (SVG puro, sin librerías) para las tarjetas KPI del
// Dashboard y la tira de stats de Leads.
//
// Regla de honestidad: si NO hay actividad en la ventana (todo 0), se muestra un
// estado vacío (línea plana tenue) — nunca una forma que simule datos que no
// existen. El caption fija el periodo y el title (hover) muestra los conteos
// reales por día.

// Línea base tenue para "sin actividad".
export function EmptyLine() {
  return (
    <svg viewBox="0 0 92 34" className="w-[92px] h-9" aria-hidden>
      <line x1="0" y1="24" x2="92" y2="24" stroke="#D8CDB5" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" />
    </svg>
  )
}

// Envoltorio: gráfica + caption del periodo + tooltip con los datos reales.
export function ChartCell({ caption, title, children }: { caption: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-0.5" title={title}>
      {children}
      <span className="text-[8.5px] uppercase tracking-wider text-[#B7AE9C] leading-none">{caption}</span>
    </div>
  )
}

// Sparkline de área: tendencia con relleno degradado y punto final.
export function Sparkline({ values, stroke, gradId }: { values: number[]; stroke: string; gradId: string }) {
  const total = values.reduce((a, b) => a + b, 0)
  if (total === 0) return <EmptyLine />
  const w = 92, h = 34
  const n = values.length
  const max = Math.max(1, ...values)
  const step = n > 1 ? w / (n - 1) : w
  const pts = values.map((v, i): [number, number] => [i * step, h - (v / max) * (h - 5) - 3])
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")
  const area = `${line} L${w},${h} L0,${h} Z`
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-[92px] h-9 overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={stroke} />
    </svg>
  )
}

// Barras: una por día; la última (hoy) resaltada. Días sin dato = punto tenue.
export function Bars({ values, color, hi }: { values: number[]; color: string; hi: string }) {
  const total = values.reduce((a, b) => a + b, 0)
  if (total === 0) return <EmptyLine />
  const w = 92, h = 34, n = values.length
  const gap = 4
  const bw = (w - gap * (n - 1)) / n
  const max = Math.max(1, ...values)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-[92px] h-9" aria-hidden>
      {values.map((v, i) => {
        if (v === 0) {
          return <circle key={i} cx={i * (bw + gap) + bw / 2} cy={h - 1.5} r="1.2" fill="#E4DCC9" />
        }
        const bh = Math.max(3, (v / max) * (h - 2))
        return (
          <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx="2" fill={i === n - 1 ? hi : color} />
        )
      })}
    </svg>
  )
}

// Anillo: proporción (0..1) con % al centro.
export function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 15
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(1, pct))
  const label = `${Math.round(p * 100)}%`
  return (
    <div className="relative w-11 h-11">
      <svg viewBox="0 0 40 40" className="w-11 h-11" aria-hidden>
        <circle cx="20" cy="20" r={r} fill="none" stroke="#EFE8DA" strokeWidth="5" />
        {p > 0 && (
          <circle
            cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform="rotate(-90 20 20)"
          />
        )}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[9px] font-bold tabular-nums" style={{ color }}>
        {label}
      </span>
    </div>
  )
}
