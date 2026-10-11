import type { Workspace } from "../app/workspace"
import type { CodeEditorRenderable } from "./CodeEditorRenderable"
import { colToIndex, indexToCol } from "../lsp/positions"
import { indentUnit } from "./decorations"
import {
  commentPrefix,
  deleteLines,
  duplicateLines,
  indentLines,
  indentString,
  moveLines,
  outdentLines,
  toggleComment,
  trimTrailingWhitespace,
  type LineEdit,
  type Sel,
} from "./lineOps"

const editorOf = (ws: Workspace) => (ws.buffers.active?.textarea ?? null) as CodeEditorRenderable | null

/** The editor's cursor and selection as string-index positions. */
function readSel(ed: CodeEditorRenderable, lines: string[]): Sel {
  const toPos = (row: number, col: number) => ({ row, index: colToIndex(lines[row] ?? "", col) })
  const { row, col } = ed.logicalCursor
  const head = toPos(row, col)
  if (!ed.hasSelection()) return { anchor: head, head }
  const s = ed.getSelection()!
  const eb = ed.editBuffer
  const a = eb.offsetToPosition(s.start)
  const b = eb.offsetToPosition(s.end)
  if (!a || !b) return { anchor: head, head }
  // The cursor is the selection's moving end; the anchor is the other one.
  const other = a.row === row && a.col === col ? b : a
  return { anchor: toPos(other.row, other.col), head }
}

/** Replace the text with the edit's lines (one undo step) and put the selection back. */
function apply(ws: Workspace, ed: CodeEditorRenderable, edit: LineEdit): void {
  const buf = ws.buffers.active!
  ws.buffers.replaceText(buf, edit.lines.join("\n"))
  const col = (p: { row: number; index: number }) => indexToCol(edit.lines[p.row] ?? "", p.index)
  const { anchor, head } = edit.sel
  if (anchor.row === head.row && anchor.index === head.index) {
    ed.goTo(head.row, col(head))
  } else {
    const eb = ed.editBuffer
    ed.setCursor(head.row, col(head))
    ed.setSelection(eb.positionToOffset(anchor.row, col(anchor)), eb.positionToOffset(head.row, col(head)))
    ed.revealLine(head.row, col(head))
    ed.requestRender()
  }
  ws.buffers.onCursorChange(buf.id)
}

/** Run a line operation on the active editor; `op` returns null for "nothing to do". */
function run(ws: Workspace, op: (lines: string[], sel: Sel, ed: CodeEditorRenderable) => LineEdit | null): void {
  const ed = editorOf(ws)
  if (!ed || !ws.buffers.active) return
  const lines = ed.plainText.split("\n")
  const edit = op(lines, readSel(ed, lines), ed)
  if (edit) apply(ws, ed, edit)
}

export function toggleLineComment(ws: Workspace, mode?: "add" | "remove"): void {
  const buf = ws.buffers.active
  if (!buf) return
  const prefix = commentPrefix(buf.filetype)
  if (!prefix) return ws.notify(`No line comments for ${buf.filetype ?? "this file"}`, "warn")
  run(ws, (lines, sel) => toggleComment(lines, sel, prefix, mode))
}

export const trimWhitespace = (ws: Workspace) => run(ws, (lines, sel) => trimTrailingWhitespace(lines, sel))

export const moveLine = (ws: Workspace, dir: -1 | 1) => run(ws, (lines, sel) => moveLines(lines, sel, dir))
export const duplicateLine = (ws: Workspace, dir: -1 | 1) => run(ws, (lines, sel) => duplicateLines(lines, sel, dir))
export const deleteLine = (ws: Workspace) => run(ws, (lines, sel) => deleteLines(lines, sel))

/**
 * Tab: with a selection, indent its lines; otherwise insert spaces up to the next indent stop
 * (or a tab, in tab-indented files). `wholeLine` (Ctrl+]) always indents the line.
 */
export function indent(ws: Workspace, wholeLine = false): void {
  const ed = editorOf(ws)
  const buf = ws.buffers.active
  if (!ed || !buf) return
  const lines = ed.plainText.split("\n")
  const unit = indentString(lines, indentUnit(lines))
  if (wholeLine || ed.hasSelection()) return run(ws, (l, sel) => indentLines(l, sel, unit))
  const text = unit === "\t" ? "\t" : " ".repeat(unit.length - (ed.logicalCursor.col % unit.length))
  ed.insertText(text)
  ws.buffers.onContentChange(buf.id)
}

/** Shift+Tab: remove one indent level from the current or selected lines. */
export function outdent(ws: Workspace): void {
  run(ws, (lines, sel) => outdentLines(lines, sel, indentUnit(lines)))
}
