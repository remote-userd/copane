/**
 * Reviewing the AI's edits in the editor: every file an AI turn changed keeps a review base, the
 * text as you last accepted it (at first, the file before the turn). What differs from the base
 * is an unreviewed AI change: marked in the gutter, peeked with Alt+N, accepted (the base takes
 * the change) or undone (the buffer takes the base lines, one undo step). Once a file matches its
 * base it drops out. Session only; your own edits inside an AI change count as part of it.
 */
import { Store } from "../app/store"
import type { Workspace } from "../app/workspace"
import type { BufferStore } from "../editor/BufferStore"
import type { CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import { applyHunk, hunkAt, hunks, revertHunk, type Hunk } from "../editor/hunks"
import type { TurnLog } from "./turns"

const lf = (text: string) => text.replace(/\r\n/g, "\n")

export class AiReview {
  /** Bumped on every change of the bases, for useSyncExternalStore. */
  readonly store = new Store<{ version: number }>({ version: 0 })
  /** Review base per path, in the order files were first changed. */
  private bases = new Map<string, string>()
  /** turnId:path pairs already taken in, so a turn re-published doesn't bring a file back. */
  private seen = new Set<string>()
  private checks = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private buffers: BufferStore) {
    // Your edits (or an undo) can bring a file back to its base: check after a pause.
    buffers.onText((id) => {
      const path = buffers.byId(id)?.path
      if (path && this.bases.has(path)) this.checkLater(path)
    })
  }

  /** Take in the files of AI turns as they are recorded. */
  watch(turns: TurnLog): () => void {
    const take = () => {
      for (const t of turns.turns) {
        for (const f of t.files) {
          const key = `${t.id}:${f.path}`
          if (this.seen.has(key) || !f.known) continue
          this.seen.add(key)
          // The earliest unreviewed turn's "before" stays the base: later turns add to the change.
          if (!this.bases.has(f.path)) this.bases.set(f.path, lf(f.before ?? ""))
          this.checkLater(f.path)
        }
      }
      this.bump()
    }
    take()
    return turns.store.subscribe(take)
  }

  /** Files with unreviewed AI changes, in the order they were changed. */
  files(): string[] {
    return [...this.bases.keys()]
  }

  has(path: string): boolean {
    return this.bases.has(path)
  }

  base(path: string): string | undefined {
    return this.bases.get(path)
  }

  /** The file's text now: the open tab's, else the disk's (null when gone). */
  async textNow(path: string): Promise<string | null> {
    const buf = this.buffers.byPath(path)
    if (buf?.kind === "text") return this.buffers.textOf(buf)
    const text = await Bun.file(path)
      .text()
      .catch(() => null)
    return text === null ? null : lf(text)
  }

  /** Unreviewed changes of a file, against the given (or current) text. */
  changes(path: string, current: string): Hunk[] {
    const base = this.bases.get(path)
    return base === undefined || base === current ? [] : hunks(base, current)
  }

  /** The change becomes part of the base: no longer marked. */
  accept(path: string, h: Hunk): void {
    const base = this.bases.get(path)
    if (base === undefined) return
    this.bases.set(path, applyHunk(base, h))
    void this.check(path)
    this.bump()
  }

  acceptFile(path: string): void {
    if (this.bases.delete(path)) this.bump()
  }

  acceptAll(): void {
    if (!this.bases.size) return
    this.bases.clear()
    this.bump()
  }

  /** Drop the file once it matches its base again (or is gone). */
  private async check(path: string): Promise<void> {
    const base = this.bases.get(path)
    if (base === undefined) return
    const now = await this.textNow(path)
    if (this.bases.get(path) !== base) return
    if (now === null || now === base) {
      this.bases.delete(path)
      this.bump()
    }
  }

  private checkLater(path: string): void {
    clearTimeout(this.checks.get(path))
    this.checks.set(
      path,
      setTimeout(() => {
        this.checks.delete(path)
        void this.check(path)
      }, 300),
    )
  }

  private bump(): void {
    this.store.set((s) => ({ version: s.version + 1 }))
  }
}

// ---- actions on the active buffer ----

const editorOf = (ws: Workspace) => (ws.buffers.active?.textarea ?? null) as CodeEditorRenderable | null

export interface AiHunkContext {
  hunk: Hunk
  all: Hunk[]
  current: string
}

/** The unreviewed AI change at a row of the active buffer. */
export function aiHunkContext(ws: Workspace, row: number): AiHunkContext | null {
  const buf = ws.buffers.active
  const ed = editorOf(ws)
  if (!ws.review || !buf || !ed || !ws.review.has(buf.path)) return null
  const current = ed.plainText
  const all = ws.review.changes(buf.path, current)
  const hunk = hunkAt(all, row)
  return hunk ? { hunk, all, current } : null
}

export function acceptAiChangeAt(ws: Workspace, row: number): string | null {
  const ctx = aiHunkContext(ws, row)
  if (!ctx) return "No AI change on this line"
  ws.review!.accept(ws.buffers.active!.path, ctx.hunk)
  return null
}

export function undoAiChangeAt(ws: Workspace, row: number): string | null {
  const buf = ws.buffers.active
  const ed = editorOf(ws)
  const ctx = aiHunkContext(ws, row)
  if (!buf || !ed || !ctx) return "No AI change on this line"
  ws.buffers.replaceText(buf, revertHunk(ctx.current, ctx.hunk)) // one undo step
  ed.goTo(Math.min(ctx.hunk.newStart, ed.lineCount - 1), 0)
  return null
}

/** Put the whole active file back to its review base (one undo step). */
export function undoAiFile(ws: Workspace): string | null {
  const buf = ws.buffers.active
  const base = buf ? ws.review?.base(buf.path) : undefined
  if (!buf || base === undefined || !buf.textarea) return "No AI changes in this file"
  ws.buffers.replaceText(buf, base)
  return null
}

/**
 * Alt+N / Alt+P: the next or previous unreviewed AI change. Past the last one in this file, opens
 * the next file with changes. Returns where the cursor went (to open the peek there), or null.
 */
export async function gotoAiChange(ws: Workspace, dir: 1 | -1, quiet = false): Promise<{ bufId: number; row: number } | null> {
  const review = ws.review
  if (!review || !review.files().length) {
    if (!quiet) ws.notify("No AI changes to review")
    return null
  }
  const buf = ws.buffers.active
  const ed = editorOf(ws)
  if (buf && ed && review.has(buf.path)) {
    const all = review.changes(buf.path, ed.plainText)
    const row = ed.logicalCursor.row
    const h = dir === 1 ? all.find((x) => x.newStart > row) : [...all].reverse().find((x) => x.newStart + Math.max(1, x.newLines) - 1 < row)
    if (h) return moveTo(ws, h)
  }
  // Another file (or this one from the top, when it is the only one).
  const files = review.files()
  const at = buf ? files.indexOf(buf.path) : -1
  for (let k = 1; k <= files.length; k++) {
    const path = files[(((at + dir * k) % files.length) + files.length) % files.length]!
    const text = await review.textNow(path)
    const all = text === null ? [] : review.changes(path, text)
    if (!all.length) continue
    const h = dir === 1 ? all[0]! : all.at(-1)!
    if (path !== buf?.path) {
      const opened = await ws.buffers.open(path)
      ws.ui.set({ focus: "editor" })
      // The editor mounts and gets its size over the next frames; the peek is placed by both.
      for (let i = 0; i < 50 && !((opened.textarea?.width ?? 0) > 1 && ws.buffers.active === opened); i++) await Bun.sleep(10)
    }
    return moveTo(ws, h)
  }
  if (!quiet) ws.notify("No AI changes to review")
  return null
}

function moveTo(ws: Workspace, h: Hunk): { bufId: number; row: number } | null {
  const buf = ws.buffers.active
  const ed = editorOf(ws)
  if (!buf || !ed) return null
  const row = Math.min(h.newStart, ed.lineCount - 1)
  ed.goTo(row, 0)
  ws.buffers.onCursorChange(buf.id)
  return { bufId: buf.id, row }
}
