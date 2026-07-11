"use client"

import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"

export type CalendarAppt = {
  id: string
  dayKey: string // YYYY-MM-DD (timezone de la marca)
  time: string // "09:00 AM"
  sortKey: number // epoch ms, para ordenar dentro del día
  leadName: string
  leadId: string | null
  dot: string // color por estado
  statusLabel: string
}

type Props = {
  items: CalendarAppt[]
  year: number
  month: number // 1-12
  monthLabel: string
  todayKey: string
  total?: number
  hiddenCount?: number
  prevHref: string
  nextHref: string
  todayHref: string
}

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
const pad2 = (n: number) => String(n).padStart(2, "0")

export function AppointmentsCalendar({
  items, year, month, monthLabel, todayKey, total, hiddenCount, prevHref, nextHref, todayHref,
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
              const dayAppts = c.key ? byDay.get(c.key) ?? [] : []
              const shown = dayAppts.slice(0, 3)
              const extra = dayAppts.length - shown.length
              return (
                <div
                  key={i}
                  className={`min-h-[96px] rounded-xl border p-1.5 flex flex-col ${
                    isToday ? "border-[#2E8B6F] bg-[#F2FBF7]" : "border-[#F1EADD] bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-[11px] font-bold tabular-nums grid place-items-center ${
                        isToday ? "w-5 h-5 rounded-full bg-[#2E8B6F] text-white" : "text-[#5C6F68]"
                      }`}
                    >
                      {c.day}
                    </span>
                    {dayAppts.length > 0 && (
                      <span className="text-[9.5px] font-semibold text-[#93A39D] tabular-nums">{dayAppts.length}</span>
                    )}
                  </div>

                  <div className="flex flex-col gap-1 min-w-0">
                    {shown.map((a) => {
                      const inner = (
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
                          {inner}
                        </Link>
                      ) : (
                        <span
                          key={a.id}
                          title={`${a.time} · ${a.leadName} · ${a.statusLabel}`}
                          className="block rounded-md px-1.5 py-1 bg-[#F6F9F6]"
                        >
                          {inner}
                        </span>
                      )
                    })}
                    {extra > 0 && (
                      <span className="text-[9.5px] font-semibold text-[#93A39D] pl-1">+{extra} más</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
