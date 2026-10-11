import { getTreeSitterClient, type SimpleHighlight } from "@opentui/core"
import { registerGrammars } from "./grammars"

// Before anything highlights: the parser worker reads the grammar list when it starts.
registerGrammars()

export const SYNTAX_HL_REF = 1

export interface LineHighlight {
  line: number
  /** Display columns, half-open. */
  start: number
  end: number
  styleId: number
}

/**
 * Tree-sitter returns ranges as JS string indices over the whole document.
 * The edit buffer wants per-line display-column ranges. Convert, splitting multi-line ranges.
 * Runs on the main thread after every pause in typing, over every highlight of the file, so it
 * avoids per-highlight allocations: on ASCII-only lines (most code) a column is just an offset.
 */
export function mapHighlights(
  text: string,
  highlights: readonly SimpleHighlight[],
  resolveStyle: (group: string) => number | null,
): LineHighlight[] {
  const lineStarts: number[] = [0]
  const wide: boolean[] = [] // per line: has non-ASCII characters (columns need measuring)
  let nonAscii = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 10) {
      wide.push(nonAscii)
      nonAscii = false
      lineStarts.push(i + 1)
    } else if (c > 127) nonAscii = true
  }
  wide.push(nonAscii)

  // Highlights come mostly in document order: step from the previous line, search only on jumps.
  let hint = 0
  const lineOf = (idx: number): number => {
    if (lineStarts[hint]! <= idx && (hint + 1 >= lineStarts.length || lineStarts[hint + 1]! > idx)) return hint
    if (hint + 2 < lineStarts.length && lineStarts[hint + 1]! <= idx && lineStarts[hint + 2]! > idx) return ++hint
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid]! <= idx) lo = mid
      else hi = mid - 1
    }
    return (hint = lo)
  }

  const colOf = (line: number, idx: number): number => {
    const start = lineStarts[line]!
    return wide[line] ? Bun.stringWidth(text.slice(start, idx)) : idx - start
  }

  const lineEnd = (line: number): number => {
    const next = lineStarts[line + 1]
    return next === undefined ? text.length : next - 1
  }

  // A few dozen distinct groups across many thousands of highlights.
  const styles = new Map<string, number | null>()
  const out: LineHighlight[] = []
  for (const [startIdx, endIdx, group] of highlights) {
    if (endIdx <= startIdx) continue
    let styleId = styles.get(group)
    if (styleId === undefined) styles.set(group, (styleId = resolveStyle(group)))
    if (styleId === null) continue
    const firstLine = lineOf(startIdx)
    const lastLine = endIdx - 1 < lineEnd(firstLine) ? firstLine : lineOf(Math.max(startIdx, endIdx - 1))
    for (let line = firstLine; line <= lastLine; line++) {
      const segStart = line === firstLine ? startIdx : lineStarts[line]!
      const segEnd = line === lastLine ? Math.min(endIdx, lineEnd(line)) : lineEnd(line)
      if (segEnd <= segStart) continue
      out.push({ line, start: colOf(line, segStart), end: colOf(line, segEnd), styleId })
    }
    if (lastLine !== firstLine) hint = firstLine // keep stepping from where the next highlight starts
  }
  return out
}

export interface HighlightTarget {
  removeHighlightsByRef(ref: number): void
  addHighlight(line: number, hl: { start: number; end: number; styleId: number; hlRef?: number | null }): void
  readonly isDestroyed: boolean
  /** The editor draws only lines near the viewport (see CodeEditorRenderable). */
  setHighlightLayer?(ref: number, highlights: readonly LineHighlight[]): void
}

export function applyHighlights(target: HighlightTarget, highlights: LineHighlight[]): void {
  if (target.setHighlightLayer) return target.setHighlightLayer(SYNTAX_HL_REF, highlights)
  target.removeHighlightsByRef(SYNTAX_HL_REF)
  for (const h of highlights) {
    target.addHighlight(h.line, { start: h.start, end: h.end, styleId: h.styleId, hlRef: SYNTAX_HL_REF })
  }
}

/** Run tree-sitter on the text. Returns null when the filetype has no parser or highlighting fails. */
export async function computeHighlights(text: string, filetype: string): Promise<SimpleHighlight[] | null> {
  const result = await getTreeSitterClient().highlightOnce(text, filetype)
  if (result.error || !result.highlights) return null
  return result.highlights
}
