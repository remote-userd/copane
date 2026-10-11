import { useSyncExternalStore } from "react"
import type { Workspace } from "../app/workspace"
import type { CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import { conflictAt, findConflicts, resolveConflict, type Conflict, type Side } from "../editor/conflicts"

/** Conflicts per buffer, kept up to date by the editor as text changes. */
const byBuffer = new Map<number, Conflict[]>()
const listeners = new Set<() => void>()
let version = 0

export function setConflicts(bufId: number, list: Conflict[]): void {
  const prev = byBuffer.get(bufId) ?? []
  if (prev.length === list.length && prev.every((c, i) => c.start === list[i]!.start && c.end === list[i]!.end)) return
  if (list.length) byBuffer.set(bufId, list)
  else byBuffer.delete(bufId)
  version++
  listeners.forEach((l) => l())
}

export function conflictsOf(bufId: number | undefined): Conflict[] {
  return bufId === undefined ? [] : (byBuffer.get(bufId) ?? [])
}

export function useConflicts(bufId: number | undefined): Conflict[] {
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => version,
  )
  return conflictsOf(bufId)
}

const editorOf = (ws: Workspace) => (ws.buffers.active?.textarea ?? null) as CodeEditorRenderable | null

/** Accept one side of the conflict at (or after) the cursor; one undo step. */
export function acceptConflict(ws: Workspace, side: Side): void {
  const ed = editorOf(ws)
  const buf = ws.buffers.active
  if (!ed || !buf) return
  const list = findConflicts(ed.plainText)
  const c = conflictAt(list, ed.logicalCursor.row)
  if (!c) return ws.notify("No merge conflict here")
  ws.buffers.replaceText(buf, resolveConflict(ed.plainText, c, side))
  ed.goTo(Math.min(c.start, ed.lineCount - 1), 0)
  const left = list.length - 1
  ws.notify(left ? `Resolved. ${left} conflict${left === 1 ? "" : "s"} left (Alt+F5 next)` : "All conflicts resolved: save, then stage the file to mark it resolved")
}

/** Move to the next / previous conflict; false when the file has none. */
export function gotoConflict(ws: Workspace, dir: 1 | -1): boolean {
  const ed = editorOf(ws)
  const buf = ws.buffers.active
  if (!ed || !buf) return false
  const list = findConflicts(ed.plainText)
  if (!list.length) return false
  const row = ed.logicalCursor.row
  const c = dir === 1 ? (list.find((x) => x.start > row) ?? list[0]!) : ([...list].reverse().find((x) => x.start < row) ?? list.at(-1)!)
  ed.goTo(c.start, 0)
  ws.buffers.onCursorChange(buf.id)
  return true
}
