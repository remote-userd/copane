import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { GitRepo, parseEntries, READ_ONLY, type StatusEntry } from "../git/repo"
import { windowFocus, windowFocused } from "../app/windowFocus"

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
  /** The upstream, e.g. "origin/main". */
  upstream?: string
}

/** Parse the `## ...` header of `git status --branch`. */
export function parseBranch(header: string): BranchInfo | null {
  const h = header.replace(/^## /, "")
  if (!h) return null
  const initial = /^No commits yet on (.+)$/.exec(h)
  if (initial) return { name: initial[1]!, ahead: 0, behind: 0 }
  if (h.startsWith("HEAD (no branch)")) return { name: "detached", ahead: 0, behind: 0, detached: true }
  const m = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(h)
  if (!m) return null
  const ahead = Number(/ahead (\d+)/.exec(m[3] ?? "")?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(m[3] ?? "")?.[1] ?? 0)
  return { name: m[1]!, ahead, behind, ...(m[2] ? { upstream: m[2] } : {}) }
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
  /** Where refs live (the main .git, also for a linked worktree). */
  private commonDir: string | null = null
  /** `git status` failures in a row: the repo may have been deleted. */
  private failures = 0
  /** Not a repo (yet): when detection was last tried, and the focus listener that retries it. */
  private lastDetect = 0
  private unwatchFocus: (() => void) | null = null
  /** The status load in progress, and the one queued behind it (callers asking mid-load share it). */
  private current: Promise<void> | null = null
  private next: Promise<void> | null = null
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
  /** Repositories inside this one (see git/repos.ts): they report their own files. */
  private excluded: string[] = []

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
    this.pollMs = pollMs
    if (await this.detect()) return
    // Not a repo: `git init` (or a clone) may come later. Look again when you come back to the
    // window, and on file changes (see refresh).
    this.unwatchFocus ??= windowFocus.subscribe(() => {
      if (windowFocused()) void this.detect()
    })
  }
  private pollMs = 2000

  /** Find the repo; true when found (status loaded, polling started). */
  private async detect(): Promise<boolean> {
    if (this.top || this.stopped) return !!this.top
    this.lastDetect = Date.now()
    // --show-toplevel resolves symlinks (macOS /var is /private/var), so its paths would not match
    // the ones the editor uses; the relative --show-cdup keeps the folder's own spelling.
    const info = await run(["git", "rev-parse", "--show-cdup", "--git-dir", "--git-common-dir"], this.root)
    if (info === null || this.stopped || this.top) return !!this.top
    const [cdup, gitDir, commonDir] = info.split("\n")
    if (cdup === undefined || !gitDir) return false
    const top = resolve(this.root, cdup)
    this.top = top
    this.repo = new GitRepo(top)
    this.gitDir = isAbsolute(gitDir) ? gitDir : join(this.root, gitDir)
    this.commonDir = commonDir ? (isAbsolute(commonDir) ? commonDir : join(this.root, commonDir)) : this.gitDir
    this.unwatchFocus?.()
    this.unwatchFocus = null
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
    }, this.pollMs)
    this.poll.unref?.()
    return true
  }

  /** The repo is gone (its folder deleted): show nothing, and look for one again as at start. */
  private lost(): void {
    if (this.poll) clearInterval(this.poll)
    this.poll = null
    this.top = null
    this.repo = null
    this.gitDir = this.commonDir = null
    this.lastOut = null
    this.failures = 0
    this.branch = null
    this.entries = []
    this.marks = new Map()
    this.dirMarks = new Map()
    this.forgetContents()
    this.snapshot++
    for (const l of this.listeners) l()
    void this.start(this.pollMs)
  }

  stop(): void {
    this.stopped = true
    this.unwatchFocus?.()
    if (this.poll) clearInterval(this.poll)
    if (this.debounce) clearTimeout(this.debounce)
  }

  /** Re-read the status soon (debounced). */
  refresh(delayMs = 300): void {
    if (this.stopped) return
    // Files change but there's no repo: maybe `git init` just ran (at most every few seconds).
    if (!this.top) {
      if (Date.now() - this.lastDetect > 3000) void this.detect()
      return
    }
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => void this.load(), delayMs)
  }

  /**
   * Leave out repositories nested in this one (they show as one untracked folder, or a submodule
   * as one changed entry): their own GitStatus reports the files inside.
   */
  exclude(tops: string[]): void {
    if (tops.length === this.excluded.length && tops.every((t, i) => t === this.excluded[i])) return
    this.excluded = tops
    this.lastOut = null
    void this.load()
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

  /** Reload the status. Resolves once a load that started after this call has finished. */
  load(): Promise<void> {
    if (!this.top) return Promise.resolve()
    if (this.current) {
      this.next ??= this.current.then(() => {
        this.next = null
        return this.load()
      })
      return this.next
    }
    this.current = this.loadOnce().finally(() => {
      this.current = null
    })
    return this.current
  }

  private async loadOnce(): Promise<void> {
    const top = this.top!
    // Runs every few seconds in the background: never take the index lock (see READ_ONLY).
    const out = await run(["git", ...READ_ONLY, "status", "--porcelain=v1", "-z", "-uall", "--branch"], this.root)
    if (this.stopped) return
    if (out === null) {
      // Failing again and again, with no HEAD left: the repo was deleted.
      if (++this.failures >= 3 && this.gitDir && !(await Bun.file(join(this.gitDir, "HEAD")).exists())) this.lost()
      return
    }
    this.failures = 0
    // Detached: the header names no commit, so HEAD says which (and moving to another one is a change).
    const sha =
      out.startsWith("## HEAD (no branch)") && this.gitDir
        ? (await Bun.file(join(this.gitDir, "HEAD")).text().catch(() => "")).trim().slice(0, 7)
        : ""
    if (this.stopped) return
    const key = sha + out
    if (key === this.lastOut) return
    this.lastOut = key
    this.branch = out.startsWith("## ") ? parseBranch(out.slice(0, out.indexOf("\0") >>> 0)) : null
    if (sha && this.branch?.detached) this.branch.name = sha
    // Parsed once: the marks come from the entries (thousands of untracked files make this add up).
    const ex = this.excluded
    this.entries = parseEntries(out, top)
    if (ex.length) this.entries = this.entries.filter((e) => !ex.some((t) => e.path === t || e.path.startsWith(t + sep)))
    this.marks = new Map()
    this.dirMarks = new Map()
    for (const e of this.entries) {
      const mark = markFor(e.x + e.y)
      if (!mark) continue
      this.marks.set(e.path, mark)
      for (let d = parentOf(e.path); d && d.length >= top.length; d = parentOf(d)) {
        const prev = this.dirMarks.get(d)
        // A parent already this strong means all of its parents are too.
        if (prev && RANK[prev] >= RANK[mark]) break
        this.dirMarks.set(d, mark)
      }
    }
    this.snapshot++
    for (const l of this.listeners) l()
  }

  /**
   * What changes when git state changes outside the editor: the index and HEAD (staging, commits,
   * checkouts), the branch's ref (reset, commit from another worktree), the upstream's ref and
   * FETCH_HEAD (fetch, push, pull), packed-refs (gc).
   */
  private async gitFingerprint(): Promise<string> {
    const files = [join(this.gitDir!, "index"), join(this.gitDir!, "HEAD")]
    const common = this.commonDir ?? this.gitDir!
    const b = this.branch
    if (b && !b.detached) files.push(join(common, "refs/heads", b.name))
    if (b?.upstream) files.push(join(common, "refs/remotes", b.upstream))
    files.push(join(common, "packed-refs"), join(common, "FETCH_HEAD"))
    const parts = await Promise.all(
      files.map(async (f) => {
        const st = await Bun.file(f)
          .stat()
          .catch(() => null)
        return st ? `${st.ino}:${st.mtimeMs}:${st.size}` : "-"
      }),
    )
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
