import { dirname, join, sep } from "node:path"
import { IgnoreMatcher } from "./ignore"
import { listDir, walkFiles, type DirEntry } from "./walk"

export interface TreeRow {
  entry: DirEntry
  depth: number
  expanded: boolean
}

type Listener = () => void

/** Lazily loaded file tree with a cached flat file list for the picker. */
export class TreeModel {
  readonly matcher: IgnoreMatcher
  private children = new Map<string, DirEntry[]>()
  private expanded = new Set<string>()
  private listeners = new Set<Listener>()
  private snapshot = 0
  selected: string | null = null
  private fileList: Promise<{ files: string[]; truncated: boolean }> | null = null
  /** Absolute paths in the resolved file list: a change to one of these leaves the list as is. */
  private listed: Set<string> | null = null

  constructor(readonly root: string) {
    this.matcher = new IgnoreMatcher(root)
    this.expanded.add(root)
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getSnapshot = () => this.snapshot
  /** Flattened rows, rebuilt only when listings or expansion change (not on selection moves). */
  private rowsCache: TreeRow[] | null = null
  private emit(structural = true) {
    if (structural) this.rowsCache = null
    this.snapshot++
    for (const l of this.listeners) l()
  }

  async load(dir = this.root): Promise<void> {
    const entries = await listDir(dir, this.matcher)
    this.children.set(dir, entries)
    if (dir === this.root && this.selected === null && entries[0]) this.selected = entries[0].path
    this.emit()
  }

  /** Re-read a folder after a change made from the tree (the watcher would catch it a bit later). */
  async refresh(dir: string): Promise<void> {
    this.forgetFiles()
    if (dir === this.root || this.children.has(dir)) await this.load(dir)
  }

  /** Keep expansion and selection when a path is renamed, and reload the affected listings. */
  async renamed(oldPath: string, newPath: string): Promise<void> {
    const inside = (p: string) => p === oldPath || p.startsWith(oldPath + sep)
    const move = (p: string) => (inside(p) ? newPath + p.slice(oldPath.length) : p)
    this.expanded = new Set([...this.expanded].map(move))
    // Cached listings under the old path hold old child paths; reload them under the new one.
    const reload = [...this.children.keys()].filter(inside).map(move)
    for (const k of [...this.children.keys()]) if (inside(k)) this.children.delete(k)
    if (this.selected) this.selected = move(this.selected)
    this.rowsCache = null
    this.forgetFiles()
    await this.refresh(dirname(oldPath))
    if (dirname(newPath) !== dirname(oldPath)) await this.refresh(dirname(newPath))
    for (const d of reload) await this.load(d)
  }

  /** Expand a folder (loading it if needed). */
  async expand(path: string): Promise<void> {
    if (!this.expanded.has(path)) await this.toggle(path)
  }

  rows(): readonly TreeRow[] {
    if (this.rowsCache) return this.rowsCache
    const out: TreeRow[] = []
    const visit = (dir: string, depth: number) => {
      for (const entry of this.children.get(dir) ?? []) {
        const expanded = entry.isDir && this.expanded.has(entry.path)
        out.push({ entry, depth, expanded })
        if (expanded) visit(entry.path, depth + 1)
      }
    }
    visit(this.root, 0)
    this.rowsCache = out
    return out
  }

  async toggle(path: string): Promise<void> {
    if (this.expanded.has(path)) {
      this.expanded.delete(path)
      this.emit()
      return
    }
    this.expanded.add(path)
    if (!this.children.has(path)) await this.load(path)
    else this.emit()
  }

  collapse(path: string): void {
    if (this.expanded.delete(path)) this.emit()
  }

  select(path: string | null): void {
    if (this.selected !== path) {
      this.selected = path
      this.emit(false)
    }
  }

  /** Move the selection by delta rows; returns the newly selected row. */
  move(delta: number): TreeRow | null {
    const rows = this.rows()
    if (rows.length === 0) return null
    const i = rows.findIndex((r) => r.entry.path === this.selected)
    const next = rows[Math.max(0, Math.min(rows.length - 1, (i === -1 ? -1 : i) + delta))]!
    this.select(next.entry.path)
    return next
  }

  /** Expand ancestors and select a file (used when a file is opened elsewhere). */
  async reveal(path: string): Promise<void> {
    const chain: string[] = []
    for (let d = dirname(path); d.startsWith(this.root) && d !== this.root; d = dirname(d)) chain.unshift(d)
    for (const d of chain) {
      this.expanded.add(d)
      if (!this.children.has(d)) this.children.set(d, await listDir(d, this.matcher))
    }
    this.selected = path
    this.emit()
  }

  /** A path changed on disk: refresh its directory listing if loaded, and the file list cache. */
  onFsChange(path: string): Promise<void> {
    return this.onFsChanges([path])
  }

  /**
   * A batch of paths changed on disk (the AI writing many files at once): each affected folder
   * is read once and the tree redraws once. The Ctrl+P list stays when only files it already
   * lists were edited, which is most changes.
   */
  async onFsChanges(changed: Iterable<string>): Promise<void> {
    const paths = [...changed]
    const dirs = new Set<string>()
    let listChanged = this.listed === null
    for (const path of paths) {
      dirs.add(dirname(path))
      dirs.add(path)
      if (path.endsWith("/.gitignore") || path.endsWith("\\.gitignore")) {
        this.matcher.invalidate(dirname(path))
        listChanged = true
      }
    }
    // Which changed paths are gone: checked together, not one after another.
    const kinds = await Promise.all(paths.map((p) => pathKind(p)))
    const gone = paths.filter((_, i) => kinds[i] === null)
    // The picker's file list only needs rebuilding for files added or removed, not for edits
    // (nor for a folder's own change event: the list holds files).
    if (!listChanged) listChanged = gone.length > 0 || paths.some((p, i) => kinds[i] === "file" && !this.listed!.has(p))
    if (listChanged) this.forgetFiles()
    // A deleted folder's listings and caches (an agent's temporary folders come and go all day).
    for (const path of gone) {
      const inside = path + sep
      for (const d of [...this.children.keys()]) if (d === path || d.startsWith(inside)) this.children.delete(d)
      for (const d of [...this.expanded]) if (d === path || d.startsWith(inside)) this.expanded.delete(d)
      this.matcher.forget(path)
      dirs.delete(path)
    }
    const loaded = [...dirs].filter((d) => this.children.has(d))
    const listings = await Promise.all(loaded.map((d) => listDir(d, this.matcher)))
    loaded.forEach((d, i) => this.children.set(d, listings[i]!))
    if (loaded.length) this.emit()
  }

  files(): Promise<{ files: string[]; truncated: boolean }> {
    if (!this.fileList) {
      const list = walkFiles(this.root, this.matcher)
      this.fileList = list
      void list.then((r) => {
        if (this.fileList === list) this.listed = new Set(r.files.map((f) => join(this.root, f)))
      })
    }
    return this.fileList
  }

  private forgetFiles(): void {
    this.fileList = null
    this.listed = null
  }
}

/** What is at a path now: a file, a folder, or nothing (Bun.file().exists() says false for folders). */
function pathKind(path: string): Promise<"file" | "dir" | null> {
  return Bun.file(path)
    .stat()
    .then(
      (s) => (s.isDirectory() ? "dir" : "file"),
      () => null,
    )
}
