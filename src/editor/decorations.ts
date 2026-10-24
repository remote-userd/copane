/** Pure helpers for cursor decorations: matching brackets, word occurrences, indent guides. */

const OPEN = "([{"
const CLOSE = ")]}"

export interface Cell {
  line: number
  /** String index within the line. */
  index: number
}

/**
 * The bracket at or just before the cursor and its partner, or null. Scans at most `limit`
 * characters (strings and comments are not special-cased).
 */
export function matchBracket(lines: string[], row: number, index: number, limit = 20_000): [Cell, Cell] | null {
  const line = lines[row] ?? ""
  const at = [index, index - 1].find((i) => i >= 0 && i < line.length && (OPEN + CLOSE).includes(line[i]!))
  if (at === undefined) return null
  const ch = line[at]!
  const open = OPEN.includes(ch)
  const pair = open ? CLOSE[OPEN.indexOf(ch)]! : OPEN[CLOSE.indexOf(ch)]!
  let depth = 0
  let seen = 0
  let r = row
  let i = at
  for (;;) {
    const l = lines[r] ?? ""
    const c = l[i]
    if (c === ch) depth++
    else if (c === pair && --depth === 0)
      return [
        { line: row, index: at },
        { line: r, index: i },
      ]
    if (++seen > limit) return null
    if (open) {
      i++
      while (i >= (lines[r]?.length ?? 0)) {
        if (++r >= lines.length) return null
        i = 0
        if ((lines[r]?.length ?? 0) > 0) break
      }
    } else {
      i--
      while (i < 0) {
        if (--r < 0) return null
        i = (lines[r]?.length ?? 0) - 1
      }
    }
  }
}

const isWord = (c: string | undefined) => !!c && /[\w$]/.test(c)

/** Other whole-word occurrences of the identifier under the cursor (at most `limit`). */
export function wordOccurrences(
  lines: string[],
  row: number,
  index: number,
  limit = 500,
): { line: number; start: number; end: number }[] {
  const line = lines[row] ?? ""
  let s = index
  let e = index
  while (s > 0 && isWord(line[s - 1])) s--
  while (e < line.length && isWord(line[e])) e++
  const word = line.slice(s, e)
  if (word.length < 2 || /^\d/.test(word)) return []
  const out: { line: number; start: number; end: number }[] = []
  for (let l = 0; l < lines.length && out.length < limit; l++) {
    const text = lines[l]!
    for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + word.length)) {
      if (isWord(text[i - 1]) || isWord(text[i + word.length])) continue
      if (l === row && i === s) continue
      out.push({ line: l, start: i, end: i + word.length })
    }
  }
  return out
}

/** Indent unit of a file: the smallest non-zero leading-space count (2 or 4 usually). */
export function indentUnit(lines: string[]): number {
  let unit = 0
  for (const l of lines.slice(0, 2000)) {
    const n = l.length - l.trimStart().length
    if (n > 0 && l[0] === " " && (unit === 0 || n < unit)) unit = n
  }
  return unit >= 2 && unit <= 8 ? unit : 2
}

/**
 * Columns where an indent guide sits on each line: every `unit` inside the leading
 * whitespace. Blank lines borrow the indent of the next non-blank line, so guides run on.
 */
export function indentGuides(lines: string[], unit: number): number[][] {
  const lead = lines.map((l) => (l.trim() ? l.length - l.trimStart().length : -1))
  for (let i = lead.length - 2; i >= 0; i--) if (lead[i] === -1) lead[i] = Math.max(0, lead[i + 1]!)
  return lead.map((n) => {
    const cols: number[] = []
    for (let c = unit; c < n; c += unit) cols.push(c)
    return cols
  })
}
