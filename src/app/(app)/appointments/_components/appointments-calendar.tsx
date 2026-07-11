"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, ArrowRight, CalendarDays } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export type CalendarAppt = {
  id: string
  dayKey: string // YYYY-MM-DD (timezone de la marca)
  time: string // "09:00 AM"
  sortKey: number // epoch ms, para ordenar dentro del día
  leadName: string
  leadId: string | null
  dot: string // color por estado
  statusLabel: string
  statusBg: string
  statusText: string
  service: string | null
  typeLabel: string
}

type Props = {
  items: CalendarAppt[]
  year: number
  month: number // 1-12
  monthLabel: string
  todayKey: string
  locale: string
  total?: number
  hiddenCount?: number
  prevHref: string
  nextHref: string
  todayHref: string
}

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
const pad2 = (n: number) => String(n).padStart(2, "0")

const GRADS = [
  "linear-gradient(150deg,#EF7B5C,#E2653F)",
  "linear-gradient(150deg,#3FA278,#2C6B57)",
  "linear-gradient(150deg,#5F8CE6,#3E63B8)",
  "linear-gradient(150deg,#E0A64E,#C88A2E)",
  "linear-gradient(150deg,#8E7CC3,#6E5AA6)",
  "linear-gradient(150deg,#D5807E,#B85D5B)",
]
function grad(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return GRADS[h % GRADS.length]
}
function initials(n: string) {
  const p = (n || "?").trim().split(/\s+/)
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "") || "?").toUpperCase()
}
function dayLabel(key: string, locale: string): string {
  const [y, m, d] = key.split("-").map(Number)
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)))
}

export function AppointmentsCalendar({
  items, year, month, monthLabel, todayKey, locale, total, hiddenCount, prevHref, nextHref, todayHref,
}: Props) {
  // Agrupar citas por día
  const byDay = new Map<string, CalendarAppt[]>()
  for (const it of items) {
    const arr = byDay.get(it.dayKey)
    if (arr) arr.push(it)
    else byDay.set(it.dayKey, [it])
  }
  // Orden dentro del día por hora real (epoch), no por texto ("1 PM" vs "9 AM").
  for (const arr of byDay.values()) arr.sort((a, b) => a.sortKey - b.sortKey)
  const showWarning = typeof hiddenCount === "number" && hiddenCount > 0

  // Día abierto en el modal (null = cerrado).
  const [openDay, setOpenDay] = useState<string | null>(null)
  const dayAppts = openDay ? byDay.get(openDay) ?? [] : []

  // Construir la cuadrícula (semanas lun→dom)
  const firstDow = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7 // Lunes = 0
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7

  const cells: Array<{ day: number | null; key: string | null }> = []
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDow + 1
    if (dayNum < 1 || dayNum > daysInMonth) cells.push({ day: null, key: null })
    else cells.push({ day: dayNum, key: `${year}-${pad2(month)}-${pad2(dayNum)}` })
  }

  return (
    <div className="bg-card border border-[#ECE3D3] rounded-2xl shadow-[0_1px_2px_rgba(26,46,40,0.05),0_10px_28px_-14px_rgba(26,46,40,0.12)] p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Link href={prevHref} aria-label="Mes anterior" className="w-8 h-8 rounded-full border border-[#ECE3D3] grid place-items-center text-[#5C6F68] hover:border-[#D8CDB5] hover:text-[#20342C] transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <h3 className="font-display text-lg font-semibold tracking-tight text-[#20342C] capitalize min-w-[150px] text-center">{monthLabel}</h3>
          <Link href={nextHref} aria-label="Mes siguiente" className="w-8 h-8 rounded-full border border-[#ECE3D3] grid place-items-center text-[#5C6F68] hover:border-[#D8CDB5] hover:text-[#20342C] transition-colors">
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        <Link href={todayHref} className="h-8 px-3.5 inline-flex items-center rounded-full text-[13px] font-medium border bg-card text-[#5C6F68] border-[#ECE3D3] hover:border-[#D8CDB5] transition-colors">
          Hoy
        </Link>
      </div>

      {showWarning && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-[#FCE9E2] text-[#C56A3E] px-3 py-2 text-[12.5px] font-semibold">
          <span>⚠</span>
          <span>
            Mostrando {(total ?? 0) - (hiddenCount ?? 0)} de {total} citas — {hiddenCount} no caben en la vista.
            Usa los filtros o cambia de mes para verlas todas.
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          {/* Días de la semana */}
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-[10px] font-bold uppercase tracking-wider text-[#93A39D] text-center py-1">{w}</div>
            ))}
          </div>

          {/* Cuadrícula */}
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((c, i) => {
              if (c.day === null) {
                return <div key={i} className="min-h-[96px] rounded-xl bg-[#FBF7EF]/60 border border-transparent" />
              }
              const isToday = c.key === todayKey
              const appts = c.key ? byDay.get(c.key) ?? [] : []
              const shown = appts.slice(0, 3)
              const extra = appts.length - shown.length
              return (
                <div
                  key={i}
                  className={`min-h-[96px] rounded-xl border p-1.5 flex flex-col ${
                    isToday ? "border-[#2E8B6F] bg-[#F2FBF7]" : "border-[#F1EADD] bg-white"
                  }`}
                >
                  {/* Nº de día → abre el modal del día */}
                  <button
                    type="button"
                    onClick={() => c.key && appts.length > 0 && setOpenDay(c.key)}
                    disabled={appts.length === 0}
                    className={`flex items-center justify-between mb-1 -mx-0.5 px-0.5 rounded ${appts.length > 0 ? "hover:bg-[#F0EBE0]/60 cursor-pointer" : "cursor-default"}`}
                    aria-label={appts.length > 0 ? `Ver ${appts.length} citas del día ${c.day}` : undefined}
                  >
                    <span
                      className={`text-[11px] font-bold tabular-nums grid place-items-center ${
                        isToday ? "w-5 h-5 rounded-full bg-[#2E8B6F] text-white" : "text-[#5C6F68]"
                      }`}
                    >
                      {c.day}
                    </span>
                    {appts.length > 0 && (
                      <span className="text-[9.5px] font-semibold text-[#2E8B6F] tabular-nums">{appts.length}</span>
                    )}
                  </button>

                  {/* Cada cita = enlace directo al lead (seguimiento) */}
                  <div className="flex flex-col gap-1 min-w-0">
                    {shown.map((a) => {
                      const chip = (
                        <span className="flex items-center gap-1 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: a.dot }} />
                          <span className="text-[10px] font-semibold text-[#5C6F68] tabular-nums shrink-0">{a.time.replace(/\s?[AP]M/i, "")}</span>
                          <span className="text-[10px] text-[#20342C] truncate">{a.leadName}</span>
                        </span>
                      )
                      return a.leadId ? (
                        <Link
                          key={a.id}
                          href={`/leads/${a.leadId}`}
                          title={`${a.time} · ${a.leadName} · ${a.statusLabel}`}
                          className="block rounded-md px-1.5 py-1 bg-[#F6F9F6] hover:bg-[#ECF4EE] transition-colors"
                        >
                          {chip}
                        </Link>
                      ) : (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => c.key && setOpenDay(c.key)}
                          title={`${a.time} · ${a.leadName} · ${a.statusLabel}`}
                          className="block w-full text-left rounded-md px-1.5 py-1 bg-[#F6F9F6] hover:bg-[#ECF4EE] transition-colors"
                        >
                          {chip}
                        </button>
                      )
                    })}
                    {extra > 0 && (
                      <button
                        type="button"
                        onClick={() => c.key && setOpenDay(c.key)}
                        className="text-[9.5px] font-semibold text-[#2E8B6F] pl-1 text-left hover:underline"
                      >
                        +{extra} más →
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Modal del día — TODAS las citas de ese día */}
      <Dialog open={openDay !== null} onOpenChange={(o) => !o && setOpenDay(null)}>
        <DialogContent className="max-w-md bg-card border-[#ECE3D3] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-left">
              <span className="w-8 h-8 rounded-[10px] bg-[#E4F2EE] grid place-items-center shrink-0">
                <CalendarDays className="w-4 h-4 text-[#2E8B6F]" />
              </span>
              <span className="font-display text-[16px] font-semibold tracking-tight text-[#20342C] capitalize">
                {openDay ? dayLabel(openDay, locale) : ""}
                <span className="text-[12px] text-[#93A39D] font-medium ml-1.5">
                  · {dayAppts.length} {dayAppts.length === 1 ? "cita" : "citas"}
                </span>
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {dayAppts.map((a) => {
              const row = (
                <div className="flex items-center gap-3 rounded-xl border border-[#F1EADD] bg-white p-2.5 hover:bg-[#FBF6EC] transition-colors">
                  <span
                    className="w-10 h-10 rounded-[13px] shrink-0 grid place-items-center text-white font-semibold text-[13px] shadow-[0_2px_6px_rgba(18,60,48,0.14)]"
                    style={{ background: grad(a.leadName) }}
                  >
                    {initials(a.leadName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[14px] text-[#20342C] truncate">{a.leadName}</div>
                    <div className="text-[12px] text-[#93A39D] truncate">
                      {a.typeLabel}{a.service ? ` · ${a.service}` : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                    <span className="font-semibold text-[13px] text-[#20342C] tabular-nums whitespace-nowrap">{a.time}</span>
                    <span
                      className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap"
                      style={{ backgroundColor: a.statusBg, color: a.statusText }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: a.dot }} />
                      {a.statusLabel}
                    </span>
                  </div>
                  {a.leadId && <ArrowRight className="w-4 h-4 text-[#B7AE9C] shrink-0" />}
                </div>
              )
              return a.leadId ? (
                <Link key={a.id} href={`/leads/${a.leadId}`} title="Ver lead · dar seguimiento" className="block">
                  {row}
                </Link>
              ) : (
                <div key={a.id}>{row}</div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
