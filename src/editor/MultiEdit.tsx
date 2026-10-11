import { useEffect, useSyncExternalStore } from "react"
import { useKeyboard } from "@opentui/react"
import { useWorkspace, type Workspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { lineAt, type CodeEditorRenderable } from "./CodeEditorRenderable"
import { getSyntaxStyle } from "./syntaxStyle"
import { colToIndex, indexToCol } from "../lsp/positions"

/**
 * Multi-cursor editing of repeated text (VS Code's Ctrl+D): every occurrence holds the same
 * text, and each keystroke is applied to all of them. The textarea has one native cursor, so
 * the edits are made here, one undo step per keystroke.
 */

interface Occ {
  row: number
  /** String index of the occurrence's start within its line. */
  start: number
}

interface State {
  bufId: number
  occs: Occ[]
  /** Current text at every occurrence. */
  value: string
  /** True until the first keystroke: typing then replaces the selected word. */
  fresh: boolean
  /** Started from a word (not a selection): match whole words only, like VS Code. */
  wholeWord: boolean
  /** Edits applied in this session; after the first, each replaces the previous undo step. */
  steps: number
}

let state: State | null = null
/** Tests: no multi-cursor session left from another test. */
export function resetMultiEdit(): void {
  state = null
}
/** Set while this module edits the buffer, so its own changes do not end the session. */
let applying = false
const listeners = new Set<() => void>()
// A new object per change, so React (useSyncExternalStore) sees every update.
const emit = () => {
  if (state) state = { ...state, occs: state.occs.map((o) => ({ ...o })) }
  listeners.forEach((l) => l())
}
const store = {
  subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
  get: () => state,
}

const HL_REF = 0x3c11
let styleId: number | null = null
const editorOf = (ws: Workspace) => (ws.buffers.active?.textarea ?? null) as CodeEditorRenderable | null

function paint(ws: Workspace): void {
  const ed = editorOf(ws)
  if (!ed) return
  ed.removeHighlightsByRef(HL_REF)
  if (!state) return ed.requestRender()
  styleId ??= getSyntaxStyle().registerStyle("multi.occurrence", { bg: colors.findCurrentBg })
  const lines = ed.plainText.split("\n")
  for (const o of state.occs) {
    const line = lines[o.row] ?? ""
    const s = indexToCol(line, o.start)
    const e = indexToCol(line, o.start + state.value.length)
    ed.addHighlight(o.row, { start: s, end: Math.max(e, s + 1), styleId, hlRef: HL_REF, priority: 12 })
  }
  ed.requestRender()
}

export function exitMultiEdit(ws: Workspace): void {
  if (!state) return
  state = null
  paint(ws)
  emit()
}

const isWordChar = (c: string | undefined) => !!c && /[\w$]/.test(c)

function occurrences(text: string, value: string, wholeWord: boolean): Occ[] {
  const out: Occ[] = []
  const lines = text.split("\n")
  lines.forEach((line, row) => {
    for (let i = line.indexOf(value); i !== -1; i = line.indexOf(value, i + Math.max(1, value.length))) {
      if (wholeWord && (isWordChar(line[i - 1]) || isWordChar(line[i + value.length]))) continue
      out.push({ row, start: i })
    }
  })
  return out
}

/** The word under the cursor, or the current one-line selection. */
function seed(ed: CodeEditorRenderable): (Occ & { value: string; wholeWord: boolean }) | null {
  const { row, col } = ed.logicalCursor
  const line = lineAt(ed, row)
  if (ed.hasSelection()) {
    const sel = ed.getSelectedText()
    if (!sel || sel.includes("\n")) return null
    const end = colToIndex(line, col)
    const start = line.slice(0, end).lastIndexOf(sel) === end - sel.length ? end - sel.length : line.indexOf(sel)
    return start < 0 ? null : { row, start, value: sel, wholeWord: false }
  }
  const idx = colToIndex(line, col)
  let s = idx
  let e = idx
  while (s > 0 && /[\w$]/.test(line[s - 1]!)) s--
  while (e < line.length && /[\w$]/.test(line[e]!)) e++
  return e > s ? { row, start: s, value: line.slice(s, e), wholeWord: true } : null
}

/** Ctrl+D: start with the word under the cursor, then add the next occurrence each time. */
export function addNextOccurrence(ws: Workspace): void {
  const ed = editorOf(ws)
  const buf = ws.buffers.active
  if (!ed || !buf) return
  if (!state || state.bufId !== buf.id) {
    const s = seed(ed)
    if (!s) return ws.notify("Put the cursor on a word (or select text) first")
    state = { bufId: buf.id, occs: [{ row: s.row, start: s.start }], value: s.value, fresh: true, wholeWord: s.wholeWord, steps: 0 }
    const line = lineAt(ed, s.row)
    ed.selectRange(s.row, indexToCol(line, s.start), indexToCol(line, s.start + s.value.length))
  } else {
    const all = occurrences(ed.plainText, state.value, state.wholeWord)
    const last = state.occs[state.occs.length - 1]!
    const taken = (o: Occ) => state!.occs.some((x) => x.row === o.row && x.start === o.start)
    const after = all.filter((o) => (o.row > last.row || (o.row === last.row && o.start > last.start)) && !taken(o))
    const next = after[0] ?? all.find((o) => !taken(o))
    if (!next) return ws.notify(`All ${state.occs.length} occurrences selected`)
    state.occs.push(next)
    const line = lineAt(ed, next.row)
    ed.revealLine(next.row, indexToCol(line, next.start))
  }
  paint(ws)
  emit()
}

/** Ctrl+Alt+A: every occurrence of the word under the cursor (or the selection). */
export function selectAllOccurrences(ws: Workspace): void {
  const ed = editorOf(ws)
  const buf = ws.buffers.active
  if (!ed || !buf) return
  const s = state?.bufId === buf.id ? { value: state.value, wholeWord: state.wholeWord } : seed(ed)
  if (!s) return ws.notify("Put the cursor on a word (or select text) first")
  state = { bufId: buf.id, occs: occurrences(ed.plainText, s.value, s.wholeWord), value: s.value, fresh: state?.fresh ?? true, wholeWord: s.wholeWord, steps: state?.steps ?? 0 }
  paint(ws)
  emit()
}

/** Replace the text at every occurrence with `next`; keeps occurrence positions in step. */
function applyValue(ws: Workspace, next: string): void {
  const ed = editorOf(ws)
  const buf = ws.buffers.active
  if (!ed || !buf || !state) return
  const old = state.value
  const lines = ed.plainText.split("\n")
  const byRow = new Map<number, Occ[]>()
  for (const o of state.occs) byRow.set(o.row, [...(byRow.get(o.row) ?? []), o])
  for (const [row, occs] of byRow) {
    occs.sort((a, b) => a.start - b.start)
    let line = lines[row] ?? ""
    let shift = 0
    for (const o of occs) {
      const at = o.start + shift
      line = line.slice(0, at) + next + line.slice(at + old.length)
      o.start = at
      shift += next.length - old.length
    }
    lines[row] = line
  }
  state.value = next
  state.fresh = false
  applying = true
  try {
    // One undo step for the whole session: undo our previous step, then apply the new text.
    if (state.steps > 0) ed.undo()
    ws.buffers.replaceText(buf, lines.join("\n"))
    state.steps++
    // Native cursor at the end of the primary (first) occurrence.
    const p = state.occs[0]!
    const pl = lines[p.row] ?? ""
    ed.goTo(p.row, indexToCol(pl, p.start + next.length))
  } finally {
    applying = false
  }
  paint(ws)
  emit()
}

/** Pasting while several occurrences are active pastes into all of them. */
export function multiPaste(ws: Workspace, text: string): boolean {
  if (!state || state.occs.length < 2 || text.includes("\n")) return false
  applyValue(ws, state.fresh ? text : state.value + text)
  return true
}

export function useMultiEditState(): State | null {
  return useSyncExternalStore(store.subscribe, store.get)
}

/** Key handling while several occurrences are active. Mounted once in the app. */
export function MultiEdit() {
  const ws = useWorkspace()
  const st = useMultiEditState()

  // Leave when the buffer changes, focus moves, or the text changed elsewhere (e.g. undo, AI).
  useEffect(() => {
    if (!st) return
    const offBuf = ws.buffers.subscribe(() => {
      if (state && ws.buffers.active?.id !== state.bufId) exitMultiEdit(ws)
    })
    // Any other edit (undo, typing elsewhere, the AI reloading the file) invalidates positions.
    const offText = ws.buffers.onText((id) => {
      if (!applying && state && id === state.bufId) exitMultiEdit(ws)
    })
    const offUi = ws.ui.subscribe(() => {
      const ui = ws.ui.get()
      if (state && (ui.focus !== "editor" || ui.modal)) exitMultiEdit(ws)
    })
    return () => {
      offBuf()
      offText()
      offUi()
    }
  }, [ws, st])

  useKeyboard((key) => {
    if (!state || state.occs.length < 2 || ws.ui.get().focus !== "editor" || ws.ui.get().modal) return
    let handled = true
    const plain = !key.ctrl && !key.meta
    if (key.name === "escape" || ["up", "down", "left", "right", "home", "end", "pageup", "pagedown", "return"].includes(key.name)) {
      exitMultiEdit(ws)
      handled = key.name === "escape"
    } else if (key.name === "backspace" && plain) applyValue(ws, state.fresh ? "" : state.value.slice(0, -1))
    else if (plain && key.sequence && key.sequence.length === 1 && key.sequence >= " ") applyValue(ws, state.fresh ? key.sequence : state.value + key.sequence)
    else handled = false
    if (handled) {
      key.preventDefault()
      key.stopPropagation()
    }
  })
  return null
}
