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
 */
export function mapHighlights(
  text: string,
  highlights: readonly SimpleHighlight[],
  resolveStyle: (group: string) => number | null,
): LineHighlight[] {
  const lineStarts: number[] = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1)

  const lineOf = (idx: number): number => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid]! <= idx) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  // Display width cache per line prefix is overkill; ASCII fast path covers most code.
  const colOf = (line: number, idx: number): number => {
    const start = lineStarts[line]!
    const prefix = text.slice(start, idx)
    // eslint-disable-next-line no-control-regex
    return /^[\x00-\x7F]*$/.test(prefix) ? prefix.length : Bun.stringWidth(prefix)
  }

  const lineEnd = (line: number): number => {
    const next = lineStarts[line + 1]
    return next === undefined ? text.length : next - 1
  }

  const out: LineHighlight[] = []
  for (const [startIdx, endIdx, group] of highlights) {
    if (endIdx <= startIdx) continue
    const styleId = resolveStyle(group)
    if (styleId === null) continue
    const firstLine = lineOf(startIdx)
    const lastLine = lineOf(Math.max(startIdx, endIdx - 1))
    for (let line = firstLine; line <= lastLine; line++) {
      const segStart = line === firstLine ? startIdx : lineStarts[line]!
      const segEnd = line === lastLine ? Math.min(endIdx, lineEnd(line)) : lineEnd(line)
      if (segEnd <= segStart) continue
      out.push({ line, start: colOf(line, segStart), end: colOf(line, segEnd), styleId })
    }
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
