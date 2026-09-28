// Genera los iconos de la app instalable (PWA) a partir del logo de HORIZON:
// fondo verde del sidebar + cuadro coral→dorado + sol (lucide "sunrise").
// Correr: node scripts/generate-pwa-icons.mjs
import sharp from "sharp"
import { mkdirSync } from "node:fs"

const SUNRISE = `
  <path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/>
  <path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/>
  <path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>`

// tile = fracción del lienzo que ocupa el cuadro coral. 0.62 cabe dentro de la
// zona segura de los iconos "maskable" de Android (círculo del 80%).
function svg(size, tile = 0.62) {
  const t = size * tile
  const o = (size - t) / 2
  const r = t * 0.24
  const icon = t * 0.6
  const io = (size - icon) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#12483B"/><stop offset="1" stop-color="#0C3B30"/>
    </linearGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FF6B5E"/><stop offset="1" stop-color="#D9A441"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)"/>
  <rect x="${o}" y="${o}" width="${t}" height="${t}" rx="${r}" fill="url(#tile)"/>
  <svg x="${io}" y="${io}" width="${icon}" height="${icon}" viewBox="0 0 24 24" fill="none"
       stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SUNRISE}</svg>
</svg>`
}

const out = (name, size, tile) =>
  sharp(Buffer.from(svg(size, tile))).png().toFile(name)

mkdirSync("public/icons", { recursive: true })
await Promise.all([
  out("public/icons/icon-192.png", 192, 0.72),
  out("public/icons/icon-512.png", 512, 0.72),
  out("public/icons/maskable-512.png", 512, 0.62),
  // Next.js inyecta estos dos solos (<link rel="icon"> y apple-touch-icon)
  out("src/app/icon.png", 64, 0.8),
  out("src/app/apple-icon.png", 180, 0.72),
])
console.log("iconos PWA generados")
