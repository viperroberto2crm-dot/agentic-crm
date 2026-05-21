"use client"

import React from "react"

/**
 * Mini-renderer de markdown para mensajes del agente.
 * Soporta: **bold**, _italic_, `code`, tablas con | pipes, listas con - / *,
 * line breaks dobles, links [text](url).
 *
 * No es react-markdown (que añade 50kb). Es suficiente para los outputs
 * que genera el bot hoy.
 */
export function AgentMessage({ text }: { text: string }) {
  return <div className="space-y-2">{renderBlocks(text)}</div>
}

function renderBlocks(text: string): React.ReactNode[] {
  // Normalizar line endings
  const normalized = text.replace(/\r\n/g, "\n")

  // Split into blocks separated by blank lines OR table boundaries
  const lines = normalized.split("\n")
  const blocks: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length > 0) blocks.push(current)
      current = []
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) blocks.push(current)

  return blocks.map((block, i) => renderBlock(block, i))
}

function renderBlock(lines: string[], key: number): React.ReactNode {
  // ¿Es una tabla? Detectar por presencia de | en al menos 2 líneas consecutivas
  // con la 2a siendo separator de guiones.
  const isTable =
    lines.length >= 2 &&
    lines[0].includes("|") &&
    /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[1])

  if (isTable) {
    return renderTable(lines, key)
  }

  // ¿Lista? Líneas que empiezan con -, * o número.
  const isList = lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))
  if (isList) {
    return (
      <ul key={key} className="list-disc pl-5 space-y-1">
        {lines.map((l, i) => (
          <li key={i} className="text-sm leading-relaxed">
            {renderInline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""))}
          </li>
        ))}
      </ul>
    )
  }

  // ¿Heading?
  const headingMatch = lines[0].match(/^(#{1,3})\s+(.+)$/)
  if (headingMatch && lines.length === 1) {
    const level = headingMatch[1].length
    const content = headingMatch[2]
    const cls =
      level === 1 ? "text-base font-bold" : level === 2 ? "text-sm font-bold" : "text-sm font-semibold"
    return (
      <p key={key} className={`${cls} text-foreground`}>
        {renderInline(content)}
      </p>
    )
  }

  // Párrafo normal — preservar line breaks dentro del párrafo
  return (
    <p key={key} className="text-sm leading-relaxed whitespace-pre-wrap">
      {lines.map((l, i) => (
        <React.Fragment key={i}>
          {renderInline(l)}
          {i < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </p>
  )
}

function renderTable(lines: string[], key: number): React.ReactNode {
  const splitRow = (line: string) =>
    line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((c) => c.trim())

  const header = splitRow(lines[0])
  // lines[1] es separator — ignorar
  const rows = lines.slice(2).map(splitRow)

  return (
    <div key={key} className="overflow-x-auto -mx-1 my-1">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border">
            {header.map((h, i) => (
              <th key={i} className="text-left font-semibold text-foreground/80 px-2 py-1.5">
                {renderInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/40 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1.5 text-foreground/80 tabular-nums">
                  {renderInline(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderInline(text: string): React.ReactNode {
  // Process **bold**, _italic_, `code`, [link](url) in single pass.
  // Tokenize into segments.
  const segments: React.ReactNode[] = []
  let remaining = text
  let key = 0
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => React.ReactNode]> = [
    [/\*\*([^*]+)\*\*/, (m) => <strong key={key} className="font-semibold">{m[1]}</strong>],
    [/_([^_]+)_/, (m) => <em key={key} className="italic">{m[1]}</em>],
    [/`([^`]+)`/, (m) => <code key={key} className="font-mono text-[0.9em] bg-secondary/60 px-1 py-0.5 rounded">{m[1]}</code>],
    [/\[([^\]]+)\]\(([^)]+)\)/, (m) => (
      <a key={key} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">
        {m[1]}
      </a>
    )],
  ]

  while (remaining.length > 0) {
    let earliestIdx = -1
    let earliestMatch: RegExpMatchArray | null = null
    let earliestRenderer: ((m: RegExpMatchArray) => React.ReactNode) | null = null
    for (const [re, render] of patterns) {
      const m = remaining.match(re)
      if (m && m.index !== undefined) {
        if (earliestIdx === -1 || m.index < earliestIdx) {
          earliestIdx = m.index
          earliestMatch = m
          earliestRenderer = render
        }
      }
    }
    if (earliestIdx === -1 || !earliestMatch || !earliestRenderer) {
      segments.push(remaining)
      break
    }
    if (earliestIdx > 0) segments.push(remaining.slice(0, earliestIdx))
    segments.push(earliestRenderer(earliestMatch))
    remaining = remaining.slice(earliestIdx + earliestMatch[0].length)
    key++
  }

  return <>{segments}</>
}
