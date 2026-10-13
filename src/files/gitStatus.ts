import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { GitRepo, parseEntries, READ_ONLY, type StatusEntry } from "../git/repo"
import { windowFocused } from "../app/windowFocus"

/** One-letter git status shown in the tree. */
export type GitMark = "M" | "A" | "U" | "D" | "R" | "!"

const RANK: Record<GitMark, number> = { "!": 5, M: 4, D: 3, A: 2, R: 2, U: 1 }

function markFor(xy: string): GitMark | null {
  const [x, y] = [xy[0]!, xy[1]!]
  if (xy === "??") return "U"
  if (xy === "!!") return null
  if (x === "U" || y === "U" || xy === "AA" || xy === "DD") return "!"
  if (x === "R" || x === "C") return "R"
  if (x === "M" || y === "M" || x === "T" || y === "T") return "M"
  if (x === "A") return "A"
  if (x === "D" || y === "D") return "D"
  return null
}

export interface BranchInfo {
  /** Branch name, or a short commit/"detached" description. */
  name: string
  ahead: number
  behind: number
  /** HEAD is on a commit, not a branch: nothing to push or publish. */
  detached?: boolean
}

/** Parse the `## ...` header of `git status --branch`. */
export function parseBranch(header: string): BranchInfo | null {
  const h = header.replace(/^## /, "")
  if (!h) return null
  const initial = /^No commits yet on (.+)$/.exec(h)
  if (initial) return { name: initial[1]!, ahead: 0, behind: 0 }
  if (h.startsWith("HEAD (no branch)")) return { name: "detached", ahead: 0, behind: 0, detached: true }
  const m = /^(.+?)(?:\.\.\.\S+)?(?: \[(.*)\])?$/.exec(h)
  if (!m) return null
  const ahead = Number(/ahead (\d+)/.exec(m[2] ?? "")?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(m[2] ?? "")?.[1] ?? 0)
  return { name: m[1]!, ahead, behind }
}

/** Parse `git status --porcelain=v1 -z` output into absolute path -> mark. */
export function parsePorcelain(out: string, repoTop: string): Map<string, GitMark> {
  const marks = new Map<string, GitMark>()
  const fields = out.split("\0")
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!
    if (f.length < 4 || f.startsWith("## ")) continue
    const xy = f.slice(0, 2)
    const rel = f.slice(3)
    // Renames and copies are followed by the original path as its own field.
    if (xy[0] === "R" || xy[0] === "C") i++
    const mark = markFor(xy)
    if (mark) marks.set(join(repoTop, rel.replace(/\/$/, "")), mark)
  }
  return marks
}

type Listener = () => void

/**
 * Git status of the workspace for the file tree. Disabled outside a git repo or without git.
 * Refreshes on demand (file changes) and when .git/index or HEAD change (staging, commits).
 */
export class GitStatus {
  private marks = new Map<string, GitMark>()
  private dirMarks = new Map<string, GitMark>()
  private listeners = new Set<Listener>()
  private snapshot = 0
  private top: string | null = null
  private gitDir: string | null = null
  private running = false
  private again = false
  private debounce: ReturnType<typeof setTimeout> | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private heads = new Map<string, Promise<string | null>>()
  private indexes = new Map<string, Promise<string | null>>()
  /** Last `git status` output; an identical one changes nothing, so listeners aren't woken. */
  private lastOut: string | null = null
  /** Current branch and how far it is from its upstream; null outside a repo. */
  branch: BranchInfo | null = null
  /** Status entries split by side (staged / unstaged / untracked / conflict). */
  entries: StatusEntry[] = []
  /** Git operations, once the repository is found. */
  repo: GitRepo | null = null

  constructor(readonly root: string) {}

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getSnapshot = () => this.snapshot

  get enabled(): boolean {
    return this.top !== null
  }

  /** Find the repo and load the first status. Resolves even when there is no repo. */
  async start(pollMs = 2000): Promise<void> {
    // --show-toplevel resolves symlinks (macOS /var is /private/var), so its paths would not match
    // the ones the editor uses; the relative --show-cdup keeps the folder's own spelling.
    const info = await run(["git", "rev-parse", "--show-cdup", "--git-dir"], this.root)
    if (info === null || this.stopped) return
    const [cdup, gitDir] = info.split("\n")
    if (cdup === undefined || !gitDir) return
    const top = resolve(this.root, cdup)
    this.top = top
    this.repo = new GitRepo(top)
    this.gitDir = isAbsolute(gitDir) ? gitDir : join(this.root, gitDir)
    await this.load()
    let last = await this.gitFingerprint()
    let busy = false
    this.poll = setInterval(async () => {
      // Nothing to show while you're in another app: catch up when the window gets focus back.
      if (busy || !windowFocused()) return
      busy = true
      const now = await this.gitFingerprint()
      busy = false
      if (now !== last) {
        last = now
        // A commit, checkout or staging changes what HEAD and the index hold.
        this.forgetContents()
        this.refresh()
      }
    }, pollMs)
    this.poll.unref?.()
  }

  stop(): void {
    this.stopped = true
    if (this.poll) clearInterval(this.poll)
    if (this.debounce) clearTimeout(this.debounce)
  }

  /** Re-read the status soon (debounced). */
  refresh(delayMs = 300): void {
    if (!this.top || this.stopped) return
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => void this.load(), delayMs)
  }

  /** Changed files (absolute paths) with their marks, sorted by path. */
  changes(): [string, GitMark][] {
    return [...this.marks].sort(([a], [b]) => a.localeCompare(b))
  }

  /** Discard all changes to a file: restore it from HEAD, or delete it when it is new. */
  async revert(path: string): Promise<string | null> {
    if (!this.top) return "Not a git repository"
    const mark = this.marks.get(path)
    const rel = relative(this.top, path).split(sep).join("/")
    if (mark === "U" || mark === "A") {
      if (mark === "A") await run(["git", "rm", "--cached", "--quiet", "--", rel], this.top)
      try {
        await Bun.file(path).delete()
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") return (err as Error).message
      }
    } else {
      const out = await run(["git", "restore", "--source=HEAD", "--staged", "--worktree", "--", rel], this.top)
      if (out === null) return `git restore failed for ${rel}`
    }
    this.heads.delete(path)
    this.indexes.delete(path)
    this.lastOut = null
    await this.load()
    return null
  }

  /** Drop cached HEAD/index contents of files that are no longer open. */
  keepContents(open: ReadonlySet<string>): void {
    for (const cache of [this.heads, this.indexes]) for (const path of cache.keys()) if (!open.has(path)) cache.delete(path)
  }

  /** After a git operation from the editor: forget cached contents and reload now. */
  async afterChange(): Promise<void> {
    this.forgetContents()
    await this.load()
  }

  /**
   * Bumped when HEAD or the index change (a commit, checkout, staging): what blame and the
   * HEAD/index contents depend on. The snapshot also moves for every other status change.
   */
  contentsVersion = 0

  /** HEAD or the index changed: cached contents are stale, and listeners must refresh even if the status reads the same. */
  private forgetContents(): void {
    this.contentsVersion++
    this.heads.clear()
    this.indexes.clear()
    this.lastOut = null
  }

  /** Staged contents of a file (falls back to HEAD), or null when untracked. Cached. */
  indexText(path: string): Promise<string | null> {
    if (!this.repo) return Promise.resolve(null)
    let p = this.indexes.get(path)
    if (!p) {
      p = this.repo.indexText(path)
      this.indexes.set(path, p)
    }
    return p
  }

  /** File contents at HEAD, or null (no repo, untracked, new). Cached until HEAD/index change. */
  headText(path: string): Promise<string | null> {
    if (!this.top) return Promise.resolve(null)
    let p = this.heads.get(path)
    if (!p) {
      const rel = relative(this.top, path).split(sep).join("/")
      p = run(["git", "show", `HEAD:${rel}`], this.top)
      this.heads.set(path, p)
    }
    return p
  }

  mark(path: string): GitMark | null {
    return this.marks.get(path) ?? null
  }

  /** Strongest mark of anything inside a folder (including deleted files). */
  dirMark(path: string): GitMark | null {
    return this.dirMarks.get(path) ?? null
  }

  async load(): Promise<void> {
    if (!this.top) return
    if (this.running) {
      this.again = true
      return
    }
    this.running = true
    try {
      // Runs every few seconds in the background: never take the index lock (see READ_ONLY).
      const out = await run(["git", ...READ_ONLY, "status", "--porcelain=v1", "-z", "-uall", "--branch"], this.root)
      if (out === null || this.stopped || out === this.lastOut) return
      this.lastOut = out
      this.branch = out.startsWith("## ") ? parseBranch(out.slice(0, out.indexOf("\0") >>> 0)) : null
      this.marks = parsePorcelain(out, this.top)
      this.entries = parseEntries(out, this.top)
      this.dirMarks = new Map()
      for (const [path, mark] of this.marks) {
        for (let d = parentOf(path); d && d.length >= this.top.length; d = parentOf(d)) {
          const prev = this.dirMarks.get(d)
          if (!prev || RANK[mark] > RANK[prev]) this.dirMarks.set(d, mark)
        }
      }
      this.snapshot++
      for (const l of this.listeners) l()
    } finally {
      this.running = false
      if (this.again) {
        this.again = false
        void this.load()
      }
    }
  }

  private async gitFingerprint(): Promise<string> {
    const parts: string[] = []
    for (const f of ["index", "HEAD"]) {
      const st = await Bun.file(join(this.gitDir!, f))
        .stat()
        .catch(() => null)
      parts.push(st ? `${st.ino}:${st.mtimeMs}:${st.size}` : "-")
    }
    return parts.join("|")
  }
}

function parentOf(path: string): string | null {
  const i = path.lastIndexOf(sep)
  return i > 0 ? path.slice(0, i) : null
}

/** Run a command; stdout on success, null on failure (including git missing). */
async function run(cmd: string[], cwd: string): Promise<string | null> {
  try {
    // No optional locks: see GIT_OPTIONAL_LOCKS in git/repo.ts.
    // A git that hangs (a network mount, a stuck lock) must not stop status updates for good.
    const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore", env: { ...Bun.env, GIT_OPTIONAL_LOCKS: "0" }, timeout: 30_000 })
    const [out, code] = await Promise.all([Bun.readableStreamToText(p.stdout), p.exited])
    return code === 0 ? out : null
  } catch {
    return null
  }
}
