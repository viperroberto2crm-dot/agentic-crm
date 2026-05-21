"use client"

import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/**
 * Picker explícito de fecha + hora con AM/PM. Reemplaza datetime-local para
 * evitar el bug en que el browser muestra 24h sin AM/PM (depende del locale)
 * y el usuario entra 5:43 pensando PM pero queda como AM.
 *
 * value: ISO local string "YYYY-MM-DDTHH:mm" (mismo formato que datetime-local).
 * onChange: emite ese mismo formato; el consumidor sigue haciendo
 *   new Date(value).toISOString() para guardar en UTC.
 */
export function DateTimeAmPm({
  value,
  onChange,
  disabled,
  required,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  required?: boolean
}) {
  // Parse current value into pieces
  const m = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/)
  const date = m?.[1] ?? ""
  const hour24 = m ? parseInt(m[2], 10) : 12
  const minute = m ? m[3] : "00"
  const ampm: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM"
  const hour12 = (() => {
    if (hour24 === 0) return 12
    if (hour24 > 12) return hour24 - 12
    return hour24
  })()

  function emit(nextDate: string, nextHour12: number, nextMin: string, nextAmpm: "AM" | "PM") {
    if (!nextDate) {
      onChange("")
      return
    }
    let h24 = nextHour12 % 12
    if (nextAmpm === "PM") h24 += 12
    const pad = (n: number | string) => String(n).padStart(2, "0")
    onChange(`${nextDate}T${pad(h24)}:${pad(nextMin)}`)
  }

  const inputCls = "bg-white border-gray-200 text-gray-800 h-9"

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-start">
      <Input
        type="date"
        value={date}
        onChange={(e) => emit(e.target.value, hour12, minute, ampm)}
        disabled={disabled}
        required={required}
        className={inputCls}
      />
      <Select
        value={String(hour12)}
        onValueChange={(v) => emit(date || todayIso(), parseInt(v, 10), minute, ampm)}
        disabled={disabled}
      >
        <SelectTrigger className="h-9 w-16 bg-white border-gray-200 text-gray-700">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-white border-gray-200 max-h-72 overflow-y-auto">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
            <SelectItem key={h} value={String(h)} className="text-gray-800">
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={minute}
        onValueChange={(v) => emit(date || todayIso(), hour12, v, ampm)}
        disabled={disabled}
      >
        <SelectTrigger className="h-9 w-16 bg-white border-gray-200 text-gray-700">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-white border-gray-200 max-h-72 overflow-y-auto">
          {["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map((m) => (
            <SelectItem key={m} value={m} className="text-gray-800">
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={ampm}
        onValueChange={(v) => emit(date || todayIso(), hour12, minute, v as "AM" | "PM")}
        disabled={disabled}
      >
        <SelectTrigger className="h-9 w-16 bg-white border-gray-200 text-gray-700 font-semibold">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-white border-gray-200">
          <SelectItem value="AM" className="text-gray-800">AM</SelectItem>
          <SelectItem value="PM" className="text-gray-800">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function todayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
