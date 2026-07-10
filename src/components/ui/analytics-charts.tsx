// Gráficas grandes para el panel "Analítica" (SVG puro, sin librerías).
// Mismas reglas de honestidad que mini-charts: sin actividad → estado claro,
// nunca formas que simulen datos inexistentes.

// Curva suave (Catmull-Rom → Bézier).
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : ""
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

// Escala un par de series al mismo eje (para comparar), con padding vertical.
function scalePair(a: number[], b: number[], w: number, h: number, pad: number) {
  const all = [...a, ...b]
  const max = Math.max(1, ...all)
  const n = a.length
  const toPts = (vals: number[]): [number, number][] =>
    vals.map((v, i) => [i * (w / (n - 1 || 1)), h - pad - (v / max) * (h - pad * 2)])
  return { a: toPts(a), b: toPts(b), max }
}

// Gráfica de 2 líneas (misma escala) con área bajo la primera.
export function DualLineChart({
  a, b, colorA, colorB, gradId,
}: {
  a: number[]; b: number[]; colorA: string; colorB: string; gradId: string
}) {
  const W = 560, H = 190, PAD = 18
  const { a: pa, b: pb } = scalePair(a, b, W, H, PAD)
  const lineA = smooth(pa)
  const lineB = smooth(pb)
  const area = `${lineA} L${W},${H} L0,${H} Z`
  const lastA = pa[pa.length - 1]
  const grid: number[] = [1, 2, 3].map((i) => PAD + i * ((H - PAD * 2) / 4))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[200px]">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colorA} stopOpacity="0.18" />
          <stop offset="1" stopColor={colorA} stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((y, i) => (
        <line key={i} x1="0" y1={y} x2={W} y2={y} stroke="#EEF2EF" strokeWidth="1" />
      ))}
      <path d={area} fill={`url(#${gradId})`} />
      <path d={lineA} fill="none" stroke={colorA} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d={lineB} fill="none" stroke={colorB} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {lastA && <circle cx={lastA[0]} cy={lastA[1]} r="4.5" fill={colorA} stroke="#fff" strokeWidth="2.5" />}
    </svg>
  )
}

// Medidor tipo gauge (semicírculo) con aguja. pct 0..1.
export function Gauge({ pct, color = "#2E8B6F", needle = "#EF7B5C" }: { pct: number; color?: string; needle?: string }) {
  const p = Math.max(0, Math.min(1, pct))
  const cx = 110, cy = 120, r = 90
  const ang = Math.PI * (1 - p) // 180°(0) → 0°(1)
  const x = cx + r * Math.cos(ang)
  const y = cy - r * Math.sin(ang)
  const large = p > 0.5 ? 1 : 0
  const nr = 64
  const nx = cx + nr * Math.cos(ang)
  const ny = cy - nr * Math.sin(ang)
  return (
    <svg viewBox="0 0 220 140" className="w-full max-w-[240px]">
      <path d="M20 120 A90 90 0 0 1 200 120" fill="none" stroke="#EEF2EF" strokeWidth="16" strokeLinecap="round" />
      {p > 0 && (
        <path d={`M20 120 A90 90 0 ${large} 1 ${x.toFixed(1)} ${y.toFixed(1)}`} fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" />
      )}
      <line x1={cx} y1={cy} x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke={needle} strokeWidth="4" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="7" fill="#fff" stroke={needle} strokeWidth="4" />
    </svg>
  )
}

// Dona con % al centro. pct 0..1.
export function DonutStat({ pct, color, big, small }: { pct: number; color: string; big: string; small: string }) {
  const r = 30, c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(1, pct))
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 76 76" className="w-[76px] h-[76px] shrink-0">
        <circle cx="38" cy="38" r={r} fill="none" stroke="#EEF2EF" strokeWidth="9" />
        {p > 0 && (
          <circle cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform="rotate(-90 38 38)" />
        )}
      </svg>
      <div className="min-w-0">
        <div className="font-display text-2xl font-semibold tracking-tight tabular-nums text-[#1C2A24]">{big}</div>
        <div className="text-[12.5px] text-[#8A968F]">{small}</div>
      </div>
    </div>
  )
}
