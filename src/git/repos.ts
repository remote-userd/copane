import { basename, join, relative, sep } from "node:path"
import { GitStatus, type GitMark } from "../files/gitStatus"
import { IgnoreMatcher } from "../files/ignore"
import { listDir } from "../files/walk"

/** More than this many repositories in one project are left out (a folder of clones, say). */
export const MAX_REPOS = 20
const RANK: Record<GitMark, number> = { "!": 5, M: 4, D: 3, A: 2, R: 2, U: 1 }
/** Folder scans on file changes, at most this often. */
const RESCAN_MS = 5000

type Listener = () => void

export interface ReposOptions {
  /** Folder levels below the project to look for repositories (git.scanDepth). */
  scanDepth?: number
  /** Folders with a .git file (submodules, linked worktrees) count too. */
  submodules?: boolean
  /** The open file's path: Source Control and the status bar follow its repository. */
  activePath?: () => string | null
  /** The project's own repository status, when made elsewhere (tests). */
  main?: GitStatus
}

/**
 * Every git repository of the project, as VS Code finds them: the one the project is in, and
 * the ones in its folders (a parent folder of clones, nested repositories, submodules) down to
 * `scanDepth` levels. Each has its own GitStatus. File-level features ask `for(path)`; repository
 * actions (commit, push, branches, history) use `current()`. The tree and the editor use the
 * merged view below (marks, HEAD and index contents, change notifications).
 */
export class GitRepos {
  /** The repository the project folder is in (disabled when there is none). */
  readonly main: GitStatus
  private nested = new Map<string, GitStatus>()
  private listeners = new Set<Listener>()
  private snapshot = 0
  private picked: string | null = null
  private pollMs = 2000
  private lastScan = 0
  private scanning: Promise<void> | null = null
  private stopped = false
  private readonly matcher: IgnoreMatcher
  private readonly scanDepth: number
  private readonly submodules: boolean
  private readonly activePath: () => string | null

  constructor(
    readonly root: string,
    { scanDepth = 1, submodules = true, activePath = () => null, main }: ReposOptions = {},
  ) {
    this.main = main ?? new GitStatus(root)
    this.main.subscribe(this.emit)
    this.matcher = new IgnoreMatcher(root)
    this.scanDepth = scanDepth
    this.submodules = submodules
    this.activePath = activePath
  }

  /** Just the repository the project is in (tests, and code made before several repos). */
  static single(status: GitStatus): GitRepos {
    return new GitRepos(status.root, { scanDepth: 0, main: status })
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getSnapshot = () => this.snapshot
  private emit = () => {
    this.snapshot++
    for (const l of this.listeners) l()
  }

  async start(pollMs = 2000): Promise<void> {
    this.pollMs = pollMs
    await Promise.all([this.main.start(pollMs), this.scan()])
  }

  stop(): void {
    this.stopped = true
    this.main.stop()
    for (const s of this.nested.values()) s.stop()
  }

  /** Look for repositories in the project's folders again (`git init` or a clone since). */
  scan(): Promise<void> {
    if (this.scanDepth === 0 || this.stopped) return Promise.resolve()
    this.scanning ??= this.scanOnce().finally(() => (this.scanning = null))
    return this.scanning
  }

  private async scanOnce(): Promise<void> {
    this.lastScan = Date.now()
    const found: string[] = []
    let level = [this.root]
    for (let depth = 1; depth <= this.scanDepth && level.length && found.length < MAX_REPOS; depth++) {
      const next: string[] = []
      for (const dir of level) {
        // Ignored folders too: a parent repository often ignores the ones cloned inside it.
        for (const e of await listDir(dir, this.matcher, true)) {
          // The home folder's tool folders (.nvm, .oh-my-zsh, ...) are clones, not your projects.
          if (!e.isDir || this.matcher.toolPath(e.path)) continue
          const dotGit = await Bun.file(join(e.path, ".git"))
            .stat()
            .catch(() => null)
          if (dotGit && (dotGit.isDirectory() || this.submodules) && found.length < MAX_REPOS) found.push(e.path)
          // Folders inside a repository are scanned too: nested repositories and submodules.
          next.push(e.path)
        }
      }
      level = next
    }
    if (this.stopped) return
    let changed = false
    for (const [top, s] of this.nested) {
      if (found.includes(top)) continue
      s.stop()
      this.nested.delete(top)
      changed = true
    }
    const fresh: GitStatus[] = []
    for (const top of found) {
      if (this.nested.has(top)) continue
      const s = new GitStatus(top)
      s.subscribe(this.emit)
      this.nested.set(top, s)
      fresh.push(s)
      changed = true
    }
    if (!changed) return
    // Each repository leaves out the ones inside it.
    const tops = [...this.nested.keys()]
    const inside = (top: string) => tops.filter((t) => t !== top && t.startsWith(top + sep))
    this.main.exclude(tops)
    for (const [top, s] of this.nested) s.exclude(inside(top))
    await Promise.all(fresh.map((s) => s.start(this.pollMs)))
    this.emit()
  }

  /** The repositories found, the project's own first. */
  list(): GitStatus[] {
    const out = this.main.enabled ? [this.main] : []
    for (const top of [...this.nested.keys()].sort()) {
      const s = this.nested.get(top)!
      if (s.enabled) out.push(s)
    }
    return out
  }

  get enabled(): boolean {
    return this.list().length > 0
  }

  /** The repository a file belongs to: the innermost one containing it. */
  for(path: string | null | undefined): GitStatus | null {
    if (!path) return null
    let best: GitStatus | null = null
    for (const s of this.list()) {
      const top = s.repo!.top
      if ((path === top || path.startsWith(top + sep)) && (!best || top.length > best.repo!.top.length)) best = s
    }
    return best
  }

  /** Where repository actions go: the one picked in Source Control, else the open file's, else the project's. */
  current(): GitStatus | null {
    const list = this.list()
    return list.find((s) => s.repo!.top === this.picked) ?? this.for(this.activePath()) ?? list[0] ?? null
  }

  /** Pick the repository Source Control shows (null: follow the open file). */
  pick(top: string | null): void {
    if (this.picked === top) return
    this.picked = top
    this.emit()
  }

  /** A short name for a repository: its folder relative to the project, or the folder's own name. */
  name(s: GitStatus): string {
    const top = s.repo?.top ?? s.root
    const rel = relative(this.root, top)
    return !rel || rel.startsWith("..") ? basename(top) : rel.split(sep).join("/")
  }

  // ---- The merged view, for the tree, the editor and the AI review ----

  mark(path: string): GitMark | null {
    return this.for(path)?.mark(path) ?? null
  }

  /** The strongest mark inside a folder, over every repository (a folder may hold several). */
  dirMark(path: string): GitMark | null {
    let best: GitMark | null = null
    for (const s of this.list()) {
      const m = s.dirMark(path)
      if (m && (!best || RANK[m] > RANK[best])) best = m
    }
    return best
  }

  headText(path: string): Promise<string | null> {
    return this.for(path)?.headText(path) ?? Promise.resolve(null)
  }

  indexText(path: string): Promise<string | null> {
    return this.for(path)?.indexText(path) ?? Promise.resolve(null)
  }

  /** Moves when any repository's HEAD or index changes (blame and gutter caches depend on it). */
  get contentsVersion(): number {
    let n = this.main.contentsVersion
    for (const s of this.nested.values()) n += s.contentsVersion
    return n
  }

  /** Re-read every repository's status soon; now and then, look for new repositories too. */
  refresh(delayMs?: number): void {
    this.main.refresh(delayMs)
    for (const s of this.nested.values()) s.refresh(delayMs)
    if (this.scanDepth > 0 && Date.now() - this.lastScan > RESCAN_MS) void this.scan()
  }

  keepContents(open: ReadonlySet<string>): void {
    this.main.keepContents(open)
    for (const s of this.nested.values()) s.keepContents(open)
  }

  /** After a git operation from the editor: every repository reloads (one command may touch several). */
  async afterChange(): Promise<void> {
    await Promise.all(this.list().map((s) => s.afterChange()))
  }

  // ---- The current repository, for code that works on one ----

  get repo() {
    return this.current()?.repo ?? null
  }
  get branch() {
    return this.current()?.branch ?? null
  }
  get entries() {
    return this.current()?.entries ?? []
  }
}
