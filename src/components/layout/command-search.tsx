"use client"

import { useEffect, useState } from "react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Sparkles, CornerDownLeft, Clock } from "lucide-react"

type Message = { role: "user" | "agent"; text: string }

type CommandSearchProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  userRole: string
}

const EXAMPLE_PROMPTS = [
  "¿Quién está bajando esta semana?",
  "¿Cuántas citas tengo hoy?",
  "Muéstrame los leads sin tocar más de 3 días",
  "¿Cuál es mi tasa de conversión este mes?",
]

export function CommandSearch({ open, onOpenChange, userRole }: CommandSearchProps) {
  const [query, setQuery] = useState("")
  const [history, setHistory] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)

  // Ctrl+K / Cmd+K global listener
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  async function handleSubmit(text: string) {
    if (!text.trim()) return
    const userMsg: Message = { role: "user", text: text.trim() }
    setHistory((h) => [...h, userMsg])
    setQuery("")
    setLoading(true)
    try {
      const res = await fetch("/api/agent/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text.trim() }),
      })
      const data = await res.json()
      const agentMsg: Message = {
        role: "agent",
        text: data.text ?? data.error ?? "Sin respuesta del agente.",
      }
      setHistory((h) => [...h, agentMsg])
    } catch {
      setHistory((h) => [...h, { role: "agent", text: "Error al conectar con el agente. Intenta de nuevo." }])
    } finally {
      setLoading(false)
    }
  }

  function handleSelect(prompt: string) {
    handleSubmit(prompt)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) {
          setQuery("")
        }
      }}
    >
      {/* Chat history */}
      {history.length > 0 && (
        <div className="px-3 py-2 max-h-48 overflow-y-auto space-y-2 border-b border-zinc-800">
          {history.map((msg, i) => (
            <div key={i} className={msg.role === "user" ? "text-right" : "text-left"}>
              <span
                className={`inline-block text-xs px-2.5 py-1.5 rounded-lg max-w-[80%] ${
                  msg.role === "user"
                    ? "bg-[hsl(var(--accent))]/20 text-zinc-200"
                    : "bg-zinc-800 text-zinc-300"
                }`}
              >
                {msg.role === "agent" && (
                  <Sparkles className="w-3 h-3 inline mr-1 text-[hsl(var(--accent))]" />
                )}
                {msg.text}
              </span>
            </div>
          ))}
          {loading && (
            <div className="text-left">
              <span className="inline-block text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 text-zinc-500">
                <span className="animate-pulse">Analizando…</span>
              </span>
            </div>
          )}
        </div>
      )}

      <CommandInput
        placeholder="Pregúntale al agente…"
        value={query}
        onValueChange={setQuery}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            handleSubmit(query)
          }
        }}
      />

      <CommandList>
        {query.trim() ? (
          <CommandGroup>
            <CommandItem
              onSelect={() => handleSubmit(query)}
              className="gap-2 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--accent))]" />
              <span className="flex-1 text-sm">{query}</span>
              <kbd className="text-[10px] text-zinc-600 font-mono flex items-center gap-0.5">
                <CornerDownLeft className="w-3 h-3" /> Enter
              </kbd>
            </CommandItem>
          </CommandGroup>
        ) : (
          <>
            {history.length > 0 && (
              <>
                <CommandGroup heading="Historial reciente">
                  {history
                    .filter((m) => m.role === "user")
                    .slice(-3)
                    .reverse()
                    .map((m, i) => (
                      <CommandItem
                        key={i}
                        onSelect={() => handleSelect(m.text)}
                        className="gap-2 cursor-pointer text-zinc-400"
                      >
                        <Clock className="w-3 h-3" />
                        <span className="text-sm truncate">{m.text}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandGroup heading="Preguntas frecuentes">
              {EXAMPLE_PROMPTS.map((p) => (
                <CommandItem
                  key={p}
                  onSelect={() => handleSelect(p)}
                  className="gap-2 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-zinc-600" />
                  <span className="text-sm text-zinc-400">{p}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        <CommandEmpty className="text-sm text-zinc-500 py-4">
          Escribe tu pregunta y presiona Enter.
        </CommandEmpty>
      </CommandList>

      <div className="border-t border-zinc-800 px-3 py-2 flex items-center gap-2 text-[10px] text-zinc-600">
        <kbd className="font-mono bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5">⌘K</kbd>
        <span>abrir / cerrar</span>
        <span className="mx-1">·</span>
        <kbd className="font-mono bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5">Esc</kbd>
        <span>cerrar</span>
        <span className="mx-1">·</span>
        <kbd className="font-mono bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5">↵</kbd>
        <span>enviar</span>
      </div>
    </CommandDialog>
  )
}
