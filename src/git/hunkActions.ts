import type { Workspace } from "../app/workspace"
import type { CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import { applyHunk, hunkAt, hunks, nextHunk, revertHunk, type Hunk } from "../editor/hunks"

/** Hunk-level git actions on the active buffer: compare it with the index (staged version). */

const editorOf = (ws: Workspace) => (ws.buffers.active?.textarea ?? null) as CodeEditorRenderable | null

/** Index text for a file, LF line endings; null when untracked or outside a repo. */
async function baseText(ws: Workspace, path: string): Promise<string | null> {
  const t = await ws.git?.indexText(path)
  return t === null || t === undefined ? null : t.replace(/\r\n/g, "\n")
}

export interface HunkContext {
  hunk: Hunk
  all: Hunk[]
  base: string
  current: string
}

/** The hunk at a row of the active buffer (or null when that line is unchanged). */
export async function hunkContext(ws: Workspace, row: number): Promise<HunkContext | null> {
  const ed = editorOf(ws)
  const buf = ws.buffers.active
  if (!ed || !buf || !ws.git?.repo) return null
  const base = await baseText(ws, buf.path)
  if (base === null) return null
  const current = ed.plainText
  const all = hunks(base, current)
  const hunk = hunkAt(all, row)
  return hunk ? { hunk, all, base, current } : null
}

export async function stageHunk(ws: Workspace, row: number): Promise<string | null> {
  const buf = ws.buffers.active
  const repo = ws.git?.repo
  if (!buf || !repo) return "Not a git repository"
  const base = await baseText(ws, buf.path)
  if (base === null) {
    // Untracked: there is no base to apply a hunk to, so stage the whole file as it is now.
    const err = await repo.setIndexText(buf.path, toEol(ws.buffers.textOf(buf), buf.eol))
    await ws.git!.afterChange()
    return err
  }
  const ctx = await hunkContext(ws, row)
  if (!ctx) return "No change on this line"
  const err = await repo.setIndexText(buf.path, toEol(applyHunk(ctx.base, ctx.hunk), buf.eol))
  await ws.git!.afterChange()
  return err
}

export async function revertHunkAt(ws: Workspace, row: number): Promise<string | null> {
  const ed = editorOf(ws)
  const buf = ws.buffers.active
  if (!ed || !buf) return "No file open"
  const ctx = await hunkContext(ws, row)
  if (!ctx) return "No change on this line"
  ws.buffers.replaceText(buf, revertHunk(ctx.current, ctx.hunk)) // one undo step
  ed.goTo(Math.min(ctx.hunk.newStart, ed.lineCount - 1), 0)
  return null
}

/** Alt+F5 / Shift+Alt+F5: move the cursor to the next or previous change in this file. */
export async function gotoChange(ws: Workspace, dir: 1 | -1): Promise<number | null> {
  const ed = editorOf(ws)
  const buf = ws.buffers.active
  if (!ed || !buf) return null
  const base = await baseText(ws, buf.path)
  if (base === null) {
    ws.notify("No changes to step through (file is not tracked)")
    return null
  }
  const h = nextHunk(hunks(base, ed.plainText), ed.logicalCursor.row, dir)
  if (!h) {
    ws.notify("No changes in this file")
    return null
  }
  const row = Math.min(h.newStart, ed.lineCount - 1)
  ed.goTo(row, 0)
  ws.buffers.onCursorChange(buf.id)
  return row
}

const toEol = (text: string, eol: string) => (eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text)
