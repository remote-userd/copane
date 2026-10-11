/** The editor works in display columns; LSP in UTF-16 indexes (= JS string indexes). */

export function indexToCol(line: string, index: number): number {
  return Bun.stringWidth(line.slice(0, Math.max(0, Math.min(index, line.length))))
}

export function colToIndex(line: string, col: number): number {
  let w = 0
  for (let i = 0; i < line.length; ) {
    if (w >= col) return i
    const cp = line.codePointAt(i)!
    const ch = String.fromCodePoint(cp)
    w += Bun.stringWidth(ch)
    i += ch.length
  }
  return line.length
}

/** The identifier-ish word ending at `index` (for completion filtering and replacement). */
export function wordBefore(line: string, index: number): { start: number; word: string } {
  let start = index
  while (start > 0 && /[\w$]/.test(line[start - 1]!)) start--
  return { start, word: line.slice(start, index) }
}
