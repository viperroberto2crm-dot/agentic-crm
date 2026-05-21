"use client"

import { useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Sparkles, CornerDownLeft, Clock, User } from "lucide-react"
import { AgentMessage } from "./agent-message"

type Message = { role: "user" | "agent"; text: string }

type CommandSearchProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  userRole: string
}

export function CommandSearch({ open, onOpenChange, userRole }: CommandSearchProps) {
  const t = useTranslations("common")
  const tNav = useTranslations("nav")
  const locale = useLocale()
  const [query, setQuery] = useState("")
  const [history, setHistory] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)

  const EXAMPLE_PROMPTS = [
    tNav("examplePrompt1"),
    tNav("examplePrompt2"),
    tNav("examplePrompt3"),
    tNav("examplePrompt4"),
  ]

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
        body: JSON.stringify({ query: text.trim(), locale }),
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
        if (!v) setQuery("")
      }}
    >
      {/* ── Historial de chat (Claude-style con colores brand) ────────────── */}
      {history.length > 0 && (
        <div className="px-5 py-4 max-h-[65vh] overflow-y-auto space-y-5 border-b border-border bg-white">
          {history.map((msg, i) => (
            <div key={i} className="flex gap-3 items-start">
              <div
                className="mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 border border-border"
                style={
                  msg.role === "agent"
                    ? { background: "var(--brand, #6366f1)", color: "white" }
                    : { background: "#f3f4f6", color: "#374151" }
                }
              >
                {msg.role === "agent" ? (
                  <Sparkles className="w-3.5 h-3.5" />
                ) : (
                  <User className="w-3.5 h-3.5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  {msg.role === "agent" ? "Agente" : "Tú"}
                </p>
                {msg.role === "agent" ? (
                  <div className="text-gray-800">
                    <AgentMessage text={msg.text} />
                  </div>
                ) : (
                  <p className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
                    {msg.text}
                  </p>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3 items-start">
              <div
                className="mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 border border-border"
                style={{ background: "var(--brand, #6366f1)", color: "white" }}
              >
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 flex items-center gap-1 pt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Input ───────────────────────────────────────────────────── */}
      <CommandInput
        placeholder={tNav("askAgentPlaceholder")}
        value={query}
        onValueChange={setQuery}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            handleSubmit(query)
          }
        }}
      />

      {/* ── Lista ───────────────────────────────────────────────────── */}
      <CommandList className="bg-white">
        {query.trim() ? (
          <CommandGroup>
            <CommandItem
              onSelect={() => handleSubmit(query)}
              className="gap-2 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span className="flex-1 text-sm text-foreground">{query}</span>
              <kbd className="text-[10px] text-muted-foreground font-mono flex items-center gap-0.5">
                <CornerDownLeft className="w-3 h-3" /> Enter
              </kbd>
            </CommandItem>
          </CommandGroup>
        ) : (
          <>
            {history.length > 0 && (
              <>
                <CommandGroup heading={tNav("recentHistory")}>
                  {history
                    .filter((m) => m.role === "user")
                    .slice(-3)
                    .reverse()
                    .map((m, i) => (
                      <CommandItem
                        key={i}
                        onSelect={() => handleSelect(m.text)}
                        className="gap-2 cursor-pointer"
                      >
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground truncate">{m.text}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandGroup heading={tNav("frequentQuestions")}>
              {EXAMPLE_PROMPTS.map((p) => (
                <CommandItem
                  key={p}
                  onSelect={() => handleSelect(p)}
                  className="gap-2 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-primary/50" />
                  <span className="text-sm text-muted-foreground">{p}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        <CommandEmpty className="text-sm text-muted-foreground py-4">
          {t("askPlaceholder")}
        </CommandEmpty>
      </CommandList>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="border-t border-border px-3 py-2 flex items-center gap-2 text-[10px] text-muted-foreground bg-white">
        <kbd className="font-mono bg-secondary border border-border rounded px-1 py-0.5">Ctrl K</kbd>
        <span>{t("open").toLowerCase()}</span>
        <span className="opacity-40">·</span>
        <kbd className="font-mono bg-secondary border border-border rounded px-1 py-0.5">Esc</kbd>
        <span>{t("close").toLowerCase()}</span>
        <span className="opacity-40">·</span>
        <kbd className="font-mono bg-secondary border border-border rounded px-1 py-0.5">↵</kbd>
        <span>{t("send").toLowerCase()}</span>
      </div>
    </CommandDialog>
  )
}
