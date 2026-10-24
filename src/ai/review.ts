/**
 * Reviewing the AI's edits in the editor: every file an AI turn changed keeps a review base, the
 * text as you last accepted it (at first, the file before the turn). What differs from the base
 * is an unreviewed AI change: marked in the gutter, peeked with Alt+N, accepted (the base takes
 * the change) or undone (the buffer takes the base lines, one undo step). Once a file matches its
 * base it drops out. Remembered across restarts (see `persist`); your own edits inside an AI
 * change count as part of it.
 */
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Store } from "../app/store"
import { openFile } from "../app/navHistory"
import type { Workspace } from "../app/workspace"
import type { BufferStore } from "../editor/BufferStore"
import type { CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import { applyHunk, hunkAt, hunks, revertHunk, type Hunk } from "../editor/hunks"
import type { GitStatus } from "../files/gitStatus"
import type { TurnLog } from "./turns"

const lf = (text: string) => text.replace(/\r\n/g, "\n")

/** Bases bigger than this aren't remembered across restarts, nor past this total. */
const MAX_SAVED_FILE = 1_000_000
const MAX_SAVED_TOTAL = 20_000_000

/** Where a project's unreviewed changes are kept between sessions (~/.local/state/copane/review/). */
export function reviewStatePath(root: string): string {
  const base = Bun.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(base, "copane", "review", `${Bun.hash(root).toString(36)}.json`)
}

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
      const live = new Set<string>()
      for (const t of turns.turns) {
        for (const f of t.files) {
          const key = `${t.id}:${f.path}`
          live.add(key)
          if (this.seen.has(key) || !f.known) continue
          this.seen.add(key)
          // The earliest unreviewed turn's "before" stays the base: later turns add to the change.
          if (!this.bases.has(f.path)) this.bases.set(f.path, lf(f.before ?? ""))
          this.checkLater(f.path)
        }
      }
      // Turns that dropped out of the log can't come back: forget them.
      for (const key of this.seen) if (!live.has(key)) this.seen.delete(key)
      this.bump()
    }
    take()
    return turns.store.subscribe(take)
  }

  /**
   * Bring back what was left to review last session. Files back at their base (or gone) drop out
   * once checked. A missing or broken file is just nothing to restore.
   */
  async load(path: string): Promise<void> {
    let saved: { files?: Record<string, unknown> }
    try {
      saved = (await Bun.file(path).json()) as typeof saved
    } catch {
      return
    }
    for (const [file, base] of Object.entries(saved.files ?? {})) {
      if (typeof base === "string" && !this.bases.has(file)) this.bases.set(file, base)
    }
    this.bump()
    await Promise.all(this.files().map((f) => this.check(f)))
  }

  /** Keep the bases on disk as they change (written after a pause; deleted when nothing is left). */
  persist(path: string, root: string): () => Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null
    const save = async (): Promise<void> => {
      timer = null
      if (!this.bases.size)
        return void (await Bun.file(path)
          .delete()
          .catch(() => null))
      const files: Record<string, string> = {}
      let total = 0
      for (const [file, base] of this.bases) {
        if (base.length > MAX_SAVED_FILE || total + base.length > MAX_SAVED_TOTAL) continue
        files[file] = base
        total += base.length
      }
      await Bun.write(path, JSON.stringify({ root, files })).catch(() => null)
    }
    const off = this.store.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void save(), 500)
    })
    // On shutdown: write what is pending, and wait for it.
    return async () => {
      off()
      if (!timer) return
      clearTimeout(timer)
      await save()
    }
  }

  /**
   * Committing accepts: a file whose content is what HEAD has (you or the AI committed it, or it
   * was checked out) has no AI changes left to review. Untracked and ignored files have no HEAD
   * text, so they stay until committed.
   */
  followGit(git: Pick<GitStatus, "headText" | "subscribe">): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null
    const sweep = async () => {
      timer = null
      // Checked together: each is a cached `git show` and a read.
      await Promise.all(
        this.files().map(async (path) => {
          const [head, now] = await Promise.all([git.headText(path), this.textNow(path)])
          if (head !== null && this.bases.has(path) && lf(head) === now) this.acceptFile(path)
        }),
      )
    }
    const off = git.subscribe(() => {
      if (!this.bases.size) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void sweep(), 300)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
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

  /** Accept every file under a folder. Returns how many. */
  acceptUnder(dir: string): number {
    const prefix = dir.endsWith("/") ? dir : dir + "/"
    let n = 0
    for (const path of [...this.bases.keys()]) if (path.startsWith(prefix) && this.bases.delete(path)) n++
    if (n) this.bump()
    return n
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
    const h =
      dir === 1
        ? all.find((x) => x.newStart > row)
        : [...all].reverse().find((x) => x.newStart + Math.max(1, x.newLines) - 1 < row)
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
    if (path !== buf?.path) await openReady(ws, path)
    return moveTo(ws, h)
  }
  if (!quiet) ws.notify("No AI changes to review")
  return null
}

/** Open a file in the editor and wait until its editor is mounted and sized (the peek is placed by both). */
async function openReady(ws: Workspace, path: string): Promise<void> {
  const opened = await openFile(ws, path)
  if (!opened) return
  for (let i = 0; i < 50 && !((opened.textarea?.width ?? 0) > 1 && ws.buffers.active === opened); i++) await Bun.sleep(10)
}

/** Open a file at its first unreviewed AI change (from the tree). Returns where the cursor went. */
export async function openAtFirstAiChange(ws: Workspace, path: string): Promise<{ bufId: number; row: number } | null> {
  await openReady(ws, path)
  const ed = editorOf(ws)
  const first = ed && ws.review ? ws.review.changes(path, ed.plainText)[0] : undefined
  return first ? moveTo(ws, first) : null
}

/**
 * What the file tree marks: files the running turn is editing (✎), files with unreviewed AI
 * changes (✦), and the folders above either. Rebuilt only when the review or the turns change.
 */
export interface AiMarks {
  file(path: string): "✎" | "✦" | null
  dir(path: string): boolean
}
let marksCache: { review: unknown; turns: unknown; marks: AiMarks } | null = null
export function aiMarks(ws: Workspace): AiMarks {
  const review = ws.review?.store.get()
  const turns = ws.turns?.store.get()
  if (marksCache && marksCache.review === review && marksCache.turns === turns) return marksCache.marks
  const editing = new Set(ws.turns?.turns.find((t) => t.endedAt === null)?.files.map((f) => f.path) ?? [])
  const unreviewed = new Set(ws.review?.files() ?? [])
  const dirs = new Set<string>()
  for (const path of [...editing, ...unreviewed]) {
    for (let d = dirname(path); d !== ws.root && d.length > ws.root.length && !dirs.has(d); d = dirname(d)) dirs.add(d)
  }
  const marks: AiMarks = {
    file: (path) => (editing.has(path) ? "✎" : unreviewed.has(path) ? "✦" : null),
    dir: (path) => dirs.has(path),
  }
  marksCache = { review, turns, marks }
  return marks
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
