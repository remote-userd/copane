/** Plain-text search inside a buffer. Smart case: case-sensitive only when the query has capitals. */

export interface Match {
  line: number
  /** Display columns (what the editor's highlight and cursor APIs use). */
  startCol: number
  endCol: number
  /** String indexes within the line. */
  start: number
  end: number
}

export function isCaseSensitive(query: string): boolean {
  return query !== query.toLowerCase()
}

export function findAll(text: string, query: string, limit = 10_000): Match[] {
  if (!query) return []
  const sensitive = isCaseSensitive(query)
  const needle = sensitive ? query : query.toLowerCase()
  const out: Match[] = []
  const lines = text.split("\n")
  for (let line = 0; line < lines.length && out.length < limit; line++) {
    const raw = lines[line]!
    const hay = sensitive ? raw : raw.toLowerCase()
    for (let i = hay.indexOf(needle); i !== -1 && out.length < limit; i = hay.indexOf(needle, i + Math.max(1, needle.length))) {
      const startCol = Bun.stringWidth(raw.slice(0, i))
      out.push({ line, start: i, end: i + needle.length, startCol, endCol: startCol + Bun.stringWidth(raw.slice(i, i + needle.length)) })
    }
  }
  return out
}

/** Index of the first match at or after (row, col), wrapping to the start. */
export function nearestMatch(matches: Match[], row: number, col: number): number {
  if (!matches.length) return -1
  const i = matches.findIndex((m) => m.line > row || (m.line === row && m.startCol >= col))
  return i === -1 ? 0 : i
}

/** Replace matches (all, or just one by index) in `text`. */
export function replaceMatches(text: string, matches: Match[], replacement: string, only?: number): string {
  const lines = text.split("\n")
  const chosen = only === undefined ? matches : matches[only] ? [matches[only]] : []
  // Right to left so earlier indexes stay valid.
  for (const m of [...chosen].sort((a, b) => b.line - a.line || b.start - a.start)) {
    const l = lines[m.line]!
    lines[m.line] = l.slice(0, m.start) + replacement + l.slice(m.end)
  }
  return lines.join("\n")
}

/** Parse "42", "42:7" or ":42" into a 0-based row/col, or an error message. */
export function parseGoto(input: string, lineCount: number): { row: number; col: number } | string {
  const m = /^\s*:?\s*(\d+)(?:\s*[:,]\s*(\d+))?\s*$/.exec(input)
  if (!m) return "Type a line number, optionally :column"
  const row = Number(m[1]) - 1
  if (row < 0 || row >= lineCount) return `Line must be 1–${lineCount}`
  return { row, col: m[2] ? Math.max(0, Number(m[2]) - 1) : 0 }
}
