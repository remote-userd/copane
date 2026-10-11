import { relative, resolve, basename, sep } from "node:path"
import { pathToFiletype, type TextareaRenderable } from "@opentui/core"
import { hashText, loadFile, saveFile, type Eol } from "./fileio"
import { mergeTexts } from "./merge"
import { applyHighlights, computeHighlights, mapHighlights } from "./highlighter"
import { getSyntaxStyle } from "./syntaxStyle"

export interface Buffer {
  id: number
  path: string
  relPath: string
  name: string
  filetype: string | undefined
  eol: Eol
  dirty: boolean
  /** File changed on disk while the buffer had unsaved edits. */
  conflict: boolean
  /** File was deleted on disk. */
  deleted: boolean
  sanitized: boolean
  /** Last text read from or written to disk: the common base when the AI edits a file you changed. */
  diskText: string
  /** On a conflict: the base your edits started from (theirs is diskText). */
  conflictBase: string | null
  /** Hash and mtime of what is on disk as far as we know. */
  diskHash: string
  diskMtimeMs: number
  /** Bumped on every content change; stale async highlight results are dropped. */
  version: number
  /** Hash of the textarea text at the last content-change check. */
  lastTextHash: string
  cursor: { row: number; col: number }
  textarea: TextareaRenderable | null
  /** Text to load into the textarea when it mounts. */
  pendingText: string | null
}

export interface BufferStoreOptions {
  root: string
  highlightDelayMs?: number
  highlightMaxBytes?: number
  /** Injectable for tests. */
  highlight?: (text: string, filetype: string) => Promise<readonly [number, number, string, unknown?][] | null>
  resolveStyle?: (group: string) => number | null
}

type Listener = () => void

export class BufferStore {
  readonly root: string
  private buffers: Buffer[] = []
  private activeId: number | null = null
  private nextId = 1
  private listeners = new Set<Listener>()
  private snapshot = 0
  private highlightTimers = new Map<number, ReturnType<typeof setTimeout>>()
  /** Hidden buffers whose colours are out of date; highlighted when shown. */
  private highlightLater = new Set<number>()
  private opts: Required<Omit<BufferStoreOptions, "root">>

  constructor(options: BufferStoreOptions) {
    this.root = resolve(options.root)
    this.opts = {
      highlightDelayMs: options.highlightDelayMs ?? 80,
      highlightMaxBytes: options.highlightMaxBytes ?? 1_000_000,
      highlight: options.highlight ?? computeHighlights,
      resolveStyle: options.resolveStyle ?? ((g) => getSyntaxStyle().getStyleId(g)),
    }
  }

  // ---- subscription (useSyncExternalStore) ----
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  getSnapshot = (): number => this.snapshot
  private emit(): void {
    this.snapshot++
    for (const l of this.listeners) l()
  }

  // ---- queries ----
  list(): readonly Buffer[] {
    return this.buffers
  }
  get active(): Buffer | null {
    return this.buffers.find((b) => b.id === this.activeId) ?? null
  }
  byPath(path: string): Buffer | null {
    const abs = resolve(this.root, path)
    return this.buffers.find((b) => b.path === abs) ?? null
  }
  byId(id: number): Buffer | null {
    return this.buffers.find((b) => b.id === id) ?? null
  }
  hasDirty(): boolean {
    return this.buffers.some((b) => b.dirty)
  }
  textOf(buf: Buffer): string {
    return buf.textarea ? buf.textarea.plainText : (buf.pendingText ?? "")
  }

  // ---- open / close / switch ----
  async open(path: string): Promise<Buffer> {
    const abs = resolve(this.root, path)
    const existing = this.byPath(abs)
    if (existing) {
      this.activate(existing.id)
      return existing
    }
    let loaded: Awaited<ReturnType<typeof loadFile>>
    let isNew = false
    try {
      loaded = await loadFile(abs)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
      // New file: empty buffer, created on first save.
      loaded = { text: "", eol: "\n", sanitized: false, mtimeMs: 0, hash: hashText("") }
      isNew = true
    }
    const buf: Buffer = {
      id: this.nextId++,
      path: abs,
      relPath: relative(this.root, abs) || basename(abs),
      name: basename(abs),
      filetype: pathToFiletype(abs),
      eol: loaded.eol,
      dirty: false,
      conflict: false,
      deleted: isNew,
      sanitized: loaded.sanitized,
      diskHash: loaded.hash,
      diskMtimeMs: loaded.mtimeMs,
      diskText: loaded.text,
      conflictBase: null,
      version: 0,
      lastTextHash: loaded.hash,
      cursor: { row: 0, col: 0 },
      textarea: null,
      pendingText: loaded.text,
    }
    this.buffers.push(buf)
    this.activeId = buf.id
    this.touchRecent(buf.path)
    this.emit()
    return buf
  }

  /** Buffers for `path` itself or anything inside it (when it is a folder). */
  private under(path: string): Buffer[] {
    return this.buffers.filter((b) => b.path === path || b.path.startsWith(path + sep))
  }

  /** A file or folder is being renamed: move open buffers along (call before renaming on disk). */
  renamePath(oldPath: string, newPath: string): void {
    const moved = this.under(oldPath)
    for (const b of moved) {
      const abs = newPath + b.path.slice(oldPath.length)
      const filetype = pathToFiletype(abs)
      const retype = filetype !== b.filetype
      b.path = abs
      b.relPath = relative(this.root, abs) || basename(abs)
      b.name = basename(abs)
      b.filetype = filetype
      if (retype) this.scheduleHighlight(b, 0)
    }
    if (moved.length) this.emit()
  }

  /** A file or folder was deleted: close clean buffers inside it, flag unsaved ones as deleted. */
  pathDeleted(path: string): void {
    const hit = this.under(path)
    for (const b of hit) {
      if (b.dirty) b.deleted = true
      else this.close(b.id)
    }
    if (hit.length) this.emit()
  }

  /** Paths of files opened in this session, most recent first (for Ctrl+P). */
  readonly recent: string[] = []

  private touchRecent(path: string): void {
    const i = this.recent.indexOf(path)
    if (i >= 0) this.recent.splice(i, 1)
    this.recent.unshift(path)
    if (this.recent.length > 50) this.recent.pop()
  }

  activate(id: number): void {
    const target = this.byId(id)
    if (target) this.touchRecent(target.path)
    if (this.activeId === id || !target) return
    this.activeId = id
    if (this.highlightLater.delete(id)) this.scheduleHighlight(target, 0)
    this.emit()
  }

  cycle(delta: number): void {
    if (this.buffers.length < 2) return
    const i = this.buffers.findIndex((b) => b.id === this.activeId)
    const next = this.buffers[(i + delta + this.buffers.length) % this.buffers.length]!
    this.activate(next.id)
  }

  /** Paths of closed tabs, most recent last (for reopening). */
  readonly closed: string[] = []

  /** Removes the buffer regardless of dirty state; callers confirm first. */
  close(id: number): void {
    const i = this.buffers.findIndex((b) => b.id === id)
    if (i === -1) return
    this.closed.push(this.buffers[i]!.path)
    if (this.closed.length > 50) this.closed.shift()
    const timer = this.highlightTimers.get(id)
    if (timer) clearTimeout(timer)
    this.highlightTimers.delete(id)
    this.highlightLater.delete(id)
    this.buffers.splice(i, 1)
    if (this.activeId === id) {
      const next = this.buffers[i] ?? this.buffers[i - 1]
      this.activeId = next?.id ?? null
      if (next && this.highlightLater.delete(next.id)) this.scheduleHighlight(next, 0)
    }
    this.emit()
  }

  // ---- textarea lifecycle (called by EditorPane) ----
  attach(id: number, textarea: TextareaRenderable | null): void {
    const buf = this.byId(id)
    if (!buf) return
    buf.textarea = textarea
    if (textarea && buf.pendingText !== null) {
      textarea.setText(buf.pendingText)
      buf.lastTextHash = hashText(buf.pendingText)
      buf.pendingText = null
      this.scheduleHighlight(buf, 0)
    }
  }

  /** Replace a buffer's whole text as one undo step (edits from find/replace, quick fixes, git...). */
  replaceText(buf: Buffer, text: string): void {
    if (!buf.textarea) return
    buf.textarea.replaceText(text)
    this.syncContent(buf)
  }

  onContentChange(id: number): void {
    const buf = this.byId(id)
    if (!buf?.textarea) return
    this.syncContent(buf)
  }

  /**
   * Recompute dirty state from the current text. Called on content changes, which include
   * undo/redo (the editor reports those itself: natively they are only a cursor move).
   */
  private syncContent(buf: Buffer): void {
    const text = buf.textarea!.plainText
    const h = hashText(text)
    const changed = h !== buf.lastTextHash
    buf.lastTextHash = h
    buf.version++
    const dirty = h !== buf.diskHash
    if (dirty !== buf.dirty) {
      buf.dirty = dirty
      this.emit()
    }
    if (changed) {
      this.scheduleHighlight(buf)
      for (const l of this.textListeners) l(buf.id)
    }
  }

  onCursorChange(id: number): void {
    const buf = this.byId(id)
    if (!buf?.textarea) return
    const { row, col } = buf.textarea.logicalCursor
    if (row !== buf.cursor.row || col !== buf.cursor.col) {
      buf.cursor = { row, col }
      this.emit()
    }
  }

  // ---- save / reload ----
  async save(id = this.activeId ?? -1): Promise<Buffer | null> {
    const buf = this.byId(id)
    if (!buf) return null
    const text = this.textOf(buf)
    const result = await saveFile(buf.path, text, buf.eol)
    buf.diskHash = result.hash
    buf.diskMtimeMs = result.mtimeMs
    buf.diskText = text
    buf.dirty = false
    buf.conflict = false
    buf.conflictBase = null
    buf.deleted = false
    this.emit()
    return buf
  }

  /**
   * Called when the file watcher reports a change. Clean buffers reload (undoably);
   * dirty buffers are flagged as conflicted instead of being overwritten.
   */
  async handleDiskChange(path: string): Promise<"ignored" | "reloaded" | "conflict" | "deleted"> {
    const buf = this.byPath(path)
    if (!buf) return "ignored"
    let loaded
    try {
      loaded = await loadFile(buf.path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        if (!buf.deleted) {
          buf.deleted = true
          this.emit()
        }
        return "deleted"
      }
      return "ignored"
    }
    buf.deleted = false
    if (loaded.hash === buf.diskHash) return "ignored" // our own save, or a touch
    if (buf.dirty) {
      // Keep the first base if the AI edits again before the conflict is resolved.
      if (!buf.conflict) buf.conflictBase = buf.diskText
      buf.conflict = true
      buf.diskText = loaded.text
      buf.diskHash = loaded.hash
      buf.diskMtimeMs = loaded.mtimeMs
      // Dirty status is relative to disk; recompute against the new disk content.
      buf.dirty = hashText(this.textOf(buf)) !== loaded.hash
      if (!buf.dirty) buf.conflict = false
      this.emit()
      return buf.conflict ? "conflict" : "reloaded"
    }
    this.replaceContents(buf, loaded.text)
    buf.eol = loaded.eol
    buf.diskHash = loaded.hash
    buf.diskMtimeMs = loaded.mtimeMs
    buf.diskText = loaded.text
    buf.dirty = false
    this.emit()
    return "reloaded"
  }

  /** Conflict resolution: take the disk version (undoable). */
  async reloadFromDisk(id: number): Promise<void> {
    const buf = this.byId(id)
    if (!buf) return
    const loaded = await loadFile(buf.path)
    this.replaceContents(buf, loaded.text)
    buf.eol = loaded.eol
    buf.diskHash = loaded.hash
    buf.diskMtimeMs = loaded.mtimeMs
    buf.diskText = loaded.text
    buf.dirty = false
    buf.conflict = false
    buf.conflictBase = null
    this.emit()
  }

  /** Conflict resolution: keep local edits; the next save overwrites disk. */
  /**
   * Your unsaved edits with the disk change (usually the AI's) applied on top, or null when
   * they touch the same lines.
   */
  mergePreview(id: number): string | null {
    const buf = this.byId(id)
    if (!buf?.conflict || buf.conflictBase === null) return null
    return mergeTexts(buf.conflictBase, this.textOf(buf), buf.diskText)
  }

  /** Resolve a conflict by keeping both changes (one undo step). Returns false if they overlap. */
  mergeConflict(id: number): boolean {
    const buf = this.byId(id)
    const merged = this.mergePreview(id)
    if (!buf || merged === null) return false
    this.replaceContents(buf, merged)
    buf.conflict = false
    buf.conflictBase = null
    buf.dirty = hashText(merged) !== buf.diskHash
    this.emit()
    return true
  }

  keepLocal(id: number): void {
    const buf = this.byId(id)
    if (!buf) return
    buf.conflict = false
    buf.conflictBase = null
    this.emit()
  }

  private reloadListeners = new Set<(id: number, before: string, after: string) => void>()
  private textListeners = new Set<(id: number) => void>()

  /** Called after every text change of any buffer (typing, undo, reload). */
  onText(listener: (id: number) => void): () => void {
    this.textListeners.add(listener)
    return () => this.textListeners.delete(listener)
  }

  /** Called when a buffer's text is replaced from disk (e.g. the AI edited the file). */
  onReload(listener: (id: number, before: string, after: string) => void): () => void {
    this.reloadListeners.add(listener)
    return () => this.reloadListeners.delete(listener)
  }

  private replaceContents(buf: Buffer, text: string): void {
    const ta = buf.textarea
    if (!ta) {
      buf.pendingText = text
      return
    }
    const before = ta.plainText
    for (const l of this.reloadListeners) l(buf.id, before, text)
    const { row, col } = ta.logicalCursor
    ta.replaceText(text)
    buf.lastTextHash = hashText(text)
    const lines = ta.lineCount
    const r = Math.min(row, Math.max(0, lines - 1))
    ta.setCursor(r, col)
    buf.version++
    this.scheduleHighlight(buf, 0)
  }

  // ---- highlighting ----
  private scheduleHighlight(buf: Buffer, delay = this.opts.highlightDelayMs): void {
    if (!buf.filetype) return
    // Restoring a session or an AI edit can touch many tabs; colour only what is on screen.
    if (buf.id !== this.activeId) {
      this.highlightLater.add(buf.id)
      return
    }
    const prev = this.highlightTimers.get(buf.id)
    if (prev) clearTimeout(prev)
    this.highlightTimers.set(
      buf.id,
      setTimeout(() => {
        this.highlightTimers.delete(buf.id)
        void this.runHighlight(buf)
      }, delay),
    )
  }

  private async runHighlight(buf: Buffer): Promise<void> {
    const ta = buf.textarea
    if (!ta || ta.isDestroyed || !buf.filetype) return
    const text = ta.plainText
    if (text.length > this.opts.highlightMaxBytes) return
    const version = buf.version
    let raw
    try {
      raw = await this.opts.highlight(text, buf.filetype)
    } catch {
      return
    }
    if (!raw || version !== buf.version || ta.isDestroyed || buf.textarea !== ta) return
    applyHighlights(ta, mapHighlights(text, raw as never, this.opts.resolveStyle))
  }

  dispose(): void {
    for (const t of this.highlightTimers.values()) clearTimeout(t)
    this.highlightTimers.clear()
  }
}
