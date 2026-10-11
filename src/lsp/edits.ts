import type { Range } from "./LspManager"

export interface TextEdit {
  range: Range
  newText: string
}

/** Offset in `text` of an LSP position (UTF-16 = JS string index within the line). */
function offsetOf(lineStarts: number[], text: string, line: number, character: number): number {
  if (line >= lineStarts.length) return text.length
  const start = lineStarts[line]!
  const end = line + 1 < lineStarts.length ? lineStarts[line + 1]! - 1 : text.length
  return Math.min(start + character, end)
}

/** Apply LSP text edits (non-overlapping, any order) to a document. */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1)
  const spans = edits
    .map((e) => ({
      from: offsetOf(starts, text, e.range.start.line, e.range.start.character),
      to: offsetOf(starts, text, e.range.end.line, e.range.end.character),
      newText: e.newText,
    }))
    .sort((a, b) => b.from - a.from || b.to - a.to)
  let out = text
  for (const s of spans) out = out.slice(0, s.from) + s.newText + out.slice(s.to)
  return out
}

/** Flatten a WorkspaceEdit (changes or documentChanges) into edits per file URI. */
export function workspaceEditFiles(edit: {
  changes?: Record<string, TextEdit[]>
  documentChanges?: { textDocument?: { uri: string }; edits?: TextEdit[] }[]
}): Map<string, TextEdit[]> {
  const out = new Map<string, TextEdit[]>()
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) out.set(uri, [...(out.get(uri) ?? []), ...edits])
  for (const dc of edit.documentChanges ?? []) {
    if (!dc.textDocument || !dc.edits) continue // create/rename/delete file operations are not supported
    out.set(dc.textDocument.uri, [...(out.get(dc.textDocument.uri) ?? []), ...dc.edits])
  }
  return out
}
