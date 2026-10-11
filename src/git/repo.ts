import { join, relative, sep } from "node:path"

/** Git operations for the editor. Every call runs `git` in the repository's top folder. */

/**
 * For status reads: `git status` otherwise takes .git/index.lock to refresh its cache, and a
 * commit or `git add` running at that moment fails with "index.lock: File exists". VS Code
 * passes the same flag for its background reads.
 */
export const READ_ONLY = ["--no-optional-locks"]

export interface RunResult {
  ok: boolean
  out: string
  err: string
}

/** Run git with optional stdin; stderr lines can be streamed (push/pull progress). */
export async function git(
  cwd: string,
  args: string[],
  opts: { stdin?: string; onErrLine?: (line: string) => void; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<RunResult> {
  try {
    const p = Bun.spawn(["git", ...args], {
      cwd,
      stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
      stdout: "pipe",
      stderr: "pipe",
      // GIT_OPTIONAL_LOCKS=0: reads (status, diff, blame…) skip the opportunistic index refresh that
      // takes .git/index.lock, so they never make a commit or `git add` fail. Writes still lock.
      env: { ...Bun.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", ...opts.env },
    })
    const timer = opts.timeoutMs ? setTimeout(() => p.kill(), opts.timeoutMs) : null
    const errChunks: string[] = []
    const readErr = (async () => {
      const dec = new TextDecoder()
      let rest = ""
      for await (const chunk of p.stderr) {
        rest += dec.decode(chunk, { stream: true })
        // Progress uses \r to redraw; treat it as a line break.
        const parts = rest.split(/[\r\n]/)
        rest = parts.pop() ?? ""
        for (const line of parts) if (line.trim()) opts.onErrLine?.(line.trim())
        errChunks.push(...parts)
      }
      if (rest.trim()) {
        opts.onErrLine?.(rest.trim())
        errChunks.push(rest)
      }
    })()
    const [out, code] = await Promise.all([Bun.readableStreamToText(p.stdout), p.exited, readErr])
    if (timer) clearTimeout(timer)
    return { ok: code === 0, out, err: errChunks.join("\n").trim() }
  } catch (err) {
    return { ok: false, out: "", err: (err as Error).message }
  }
}

/** The most useful line of a git error (skips hints and blank lines). */
export function firstError(err: string): string {
  const lines = err.split("\n").map((l) => l.trim()).filter(Boolean)
  return (lines.find((l) => /^(fatal|error):/i.test(l)) ?? lines.find((l) => !/^hint:/i.test(l)) ?? "git failed").replace(/^(fatal|error):\s*/i, "")
}

/** A file an agent changed in its worktree since it split off. */
export interface WorktreeChange {
  rel: string
  status: "A" | "M" | "D"
}

/** A unified diff without its `diff --git` / index / ---/+++ header lines. */
function stripHeader(raw: string): string {
  const i = raw.indexOf("\n@@")
  return i < 0 ? (raw.startsWith("@@") ? raw : "") : raw.slice(i + 1)
}

export interface StatusEntry {
  path: string
  rel: string
  /** Index (staged) and worktree columns of `git status --porcelain`. */
  x: string
  y: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflict: boolean
}

/** Porcelain v1 -z entries, split by side (for the Source Control panel). */
export function parseEntries(out: string, top: string): StatusEntry[] {
  const entries: StatusEntry[] = []
  const fields = out.split("\0")
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!
    if (f.length < 4 || f.startsWith("## ")) continue
    const x = f[0]!
    const y = f[1]!
    const rel = f.slice(3).replace(/\/$/, "")
    if (x === "R" || x === "C") i++
    if (x === "!" && y === "!") continue
    const untracked = x === "?" && y === "?"
    const conflict = x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")
    entries.push({
      path: join(top, rel),
      rel,
      x,
      y,
      untracked,
      conflict,
      staged: !untracked && !conflict && x !== " ",
      unstaged: untracked || (!conflict && y !== " "),
    })
  }
  return entries.sort((a, b) => a.rel.localeCompare(b.rel))
}

export interface BlameLine {
  sha: string
  author: string
  time: number
  summary: string
}

/** `git blame --porcelain` → one entry per line (index = line number - 1). */
function parseBlame(out: string): BlameLine[] {
  const commits = new Map<string, BlameLine>()
  const lines: BlameLine[] = []
  const rows = out.split("\n")
  for (let i = 0; i < rows.length; i++) {
    const head = /^([0-9a-f]{40}) \d+ (\d+)/.exec(rows[i]!)
    if (!head) continue
    const sha = head[1]!
    const finalLine = Number(head[2]) - 1
    let c = commits.get(sha)
    if (!c) {
      c = { sha, author: "", time: 0, summary: "" }
      commits.set(sha, c)
    }
    // Header lines follow until the content line, which starts with a tab.
    for (i++; i < rows.length && !rows[i]!.startsWith("\t"); i++) {
      const r = rows[i]!
      if (r.startsWith("author ")) c.author = r.slice(7)
      else if (r.startsWith("author-time ")) c.time = Number(r.slice(12))
      else if (r.startsWith("summary ")) c.summary = r.slice(8)
    }
    lines[finalLine] = c
  }
  return lines
}

export interface LogEntry {
  sha: string
  author: string
  when: string
  subject: string
}

function parseLog(out: string): LogEntry[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha = "", author = "", when = "", subject = ""] = l.split("\x1f")
      return { sha, author, when, subject }
    })
}

export interface Branch {
  name: string
  current: boolean
}

export const NOT_COMMITTED = "0000000000000000000000000000000000000000"

export class GitRepo {
  constructor(readonly top: string) {}

  rel(path: string): string {
    return relative(this.top, path).split(sep).join("/")
  }

  private run(args: string[], opts?: Parameters<typeof git>[2]) {
    return git(this.top, args, opts)
  }

  async status(): Promise<StatusEntry[]> {
    const r = await this.run([...READ_ONLY, "status", "--porcelain=v1", "-z", "-uall"])
    return r.ok ? parseEntries(r.out, this.top) : []
  }

  async stage(paths: string[]): Promise<string | null> {
    const r = await this.run(["add", "--", ...paths.map((p) => this.rel(p))])
    return r.ok ? null : firstError(r.err)
  }

  async stageAll(): Promise<string | null> {
    const r = await this.run(["add", "-A"])
    return r.ok ? null : firstError(r.err)
  }

  async unstage(paths: string[]): Promise<string | null> {
    // Before the first commit there is no HEAD to restore from: drop from the index instead.
    const hasHead = (await this.run(["rev-parse", "--verify", "-q", "HEAD"])).ok
    const args = hasHead ? ["restore", "--staged", "--"] : ["rm", "--cached", "-q", "--"]
    const r = await this.run([...args, ...paths.map((p) => this.rel(p))])
    return r.ok ? null : firstError(r.err)
  }

  /** The staged contents of a file, or null when it is not in the index. */
  async indexText(path: string): Promise<string | null> {
    const r = await this.run(["show", `:${this.rel(path)}`])
    return r.ok ? r.out : null
  }

  /** Replace the staged contents of a file (used to stage a single hunk). */
  async setIndexText(path: string, text: string): Promise<string | null> {
    const rel = this.rel(path)
    const hash = await this.run(["hash-object", "-w", "--stdin"], { stdin: text })
    if (!hash.ok) return firstError(hash.err)
    const ls = await this.run(["ls-files", "-s", "--", rel])
    const mode = /^(\d{6}) /.exec(ls.out)?.[1] ?? "100644"
    const r = await this.run(["update-index", "--add", "--cacheinfo", `${mode},${hash.out.trim()},${rel}`])
    return r.ok ? null : firstError(r.err)
  }

  async commit(message: string, amend = false): Promise<{ sha: string } | { error: string }> {
    const r = await this.run(["commit", ...(amend ? ["--amend"] : []), "-F", "-"], { stdin: message })
    if (!r.ok) return { error: firstError(r.err || r.out) }
    const sha = (await this.run(["rev-parse", "--short", "HEAD"])).out.trim()
    return { sha }
  }

  async lastMessage(): Promise<string> {
    const r = await this.run(["log", "-1", "--format=%B"])
    return r.ok ? r.out.trim() : ""
  }

  /** Unified diff of one file: staged (index vs HEAD) or unstaged (worktree vs index). */
  async diff(path: string, staged: boolean, untracked = false): Promise<string> {
    if (untracked) {
      const text = await Bun.file(path).text().catch(() => "")
      const lines = text.replace(/\n$/, "").split("\n")
      return [`@@ -0,0 +1,${lines.length} @@ new file`, ...lines.map((l) => "+" + l)].join("\n")
    }
    const r = await this.run(["diff", "--no-color", "--no-ext-diff", ...(staged ? ["--cached"] : []), "--", this.rel(path)])
    return r.out.split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l)).join("\n")
  }

  /**
   * What to hand the AI for review: the staged changes when there are any, otherwise everything
   * uncommitted (against HEAD), with a --stat summary and the new, untracked files.
   */
  async changesForReview(): Promise<{ diff: string; stat: string; staged: boolean; untracked: string[] }> {
    const entries = await this.status()
    const staged = entries.some((e) => e.staged)
    const hasHead = (await this.run(["rev-parse", "--verify", "-q", "HEAD"])).ok
    const range = staged ? ["--cached"] : hasHead ? ["HEAD"] : []
    const [diff, stat] = await Promise.all([
      this.run(["diff", "--no-color", "--no-ext-diff", ...range]),
      this.run(["diff", "--stat", "--no-color", ...range]),
    ])
    const untracked = staged ? [] : entries.filter((e) => e.untracked).map((e) => e.rel)
    return { diff: diff.out, stat: stat.out, staged, untracked }
  }

  /**
   * A commit object holding the working tree's tracked files as they are now, without touching
   * the working tree, the index or the stash list (`git stash create`); HEAD when nothing is
   * modified; null before the first commit. Used to undo an AI turn.
   */
  async snapshot(): Promise<string | null> {
    const created = (await this.run([...READ_ONLY, "stash", "create"])).out.trim()
    if (created) return created
    const head = await this.run(["rev-parse", "--verify", "-q", "HEAD"])
    return head.ok ? head.out.trim() : null
  }

  /** A file's content in a commit, or null when the commit doesn't have it. */
  async showAt(sha: string, path: string): Promise<string | null> {
    const r = await this.run(["show", `${sha}:${this.rel(path).split(sep).join("/")}`])
    return r.ok ? r.out : null
  }

  async isIgnored(path: string): Promise<boolean> {
    return (await this.run(["check-ignore", "-q", "--", this.rel(path)])).ok
  }

  /** A new worktree at `path` on a new branch from HEAD, for an agent to work in on its own. */
  async addWorktree(path: string, branch: string): Promise<string | null> {
    const r = await this.run(["worktree", "add", "-b", branch, path, "HEAD"])
    return r.ok ? null : firstError(r.err)
  }

  /** Remove a worktree (its branch stays). Refuses when it has uncommitted changes unless `force`. */
  async removeWorktree(path: string, force = false): Promise<string | null> {
    const r = await this.run(["worktree", "remove", ...(force ? ["--force"] : []), path])
    return r.ok ? null : firstError(r.err)
  }

  // ---- an agent's worktree: what it changed, and bringing it back ----

  async branchExists(name: string): Promise<boolean> {
    return (await this.run(["rev-parse", "--verify", "-q", `refs/heads/${name}`])).ok
  }

  /** Where `branch` split from HEAD (`git merge-base`), or null. */
  async mergeBase(branch: string): Promise<string | null> {
    const r = await this.run(["merge-base", "HEAD", branch])
    return r.ok ? r.out.trim() : null
  }

  /**
   * Run in a worktree: every file changed since `base`, committed or not, untracked files
   * included. Paths are relative to the worktree, sorted.
   */
  async changesSince(base: string): Promise<WorktreeChange[]> {
    const r = await this.run(["diff", "--name-status", "--no-renames", "-z", base])
    const out = new Map<string, WorktreeChange>()
    const parts = r.ok ? r.out.split("\0") : []
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const status = parts[i]!.charAt(0)
      const rel = parts[i + 1]!
      if (rel) out.set(rel, { rel, status: status === "A" || status === "D" ? status : "M" })
    }
    for (const e of await this.status()) if (e.untracked) out.set(e.rel, { rel: e.rel, status: "A" })
    return [...out.values()].sort((a, b) => a.rel.localeCompare(b.rel))
  }

  /** Run in a worktree: the unified diff of one file since `base` (a new file shows whole). */
  async diffSince(base: string, change: WorktreeChange): Promise<string> {
    // Untracked: git diff can't see it against a commit; compare with nothing instead.
    if (change.status === "A" && !(await this.run(["ls-files", "--error-unmatch", "--", change.rel])).ok) {
      const r = await this.run(["diff", "--no-color", "--no-index", "--", "/dev/null", change.rel])
      return stripHeader(r.out)
    }
    const r = await this.run(["diff", "--no-color", "--no-ext-diff", base, "--", change.rel])
    return stripHeader(r.out)
  }

  /** Commit everything in this (work)tree, untracked files too. Nothing to commit is not an error. */
  async commitAll(message: string): Promise<string | null> {
    if (!(await this.status()).length) return null
    const add = await this.run(["add", "-A"])
    if (!add.ok) return firstError(add.err)
    const r = await this.run(["commit", "-q", "-F", "-"], { stdin: message })
    return r.ok ? null : firstError(r.err || r.out)
  }

  /** Merge a branch into the current one (always a merge commit). Conflicts are left in the files. */
  async merge(branch: string): Promise<{ ok: true } | { conflicts: number } | { error: string }> {
    const r = await this.run(["merge", "--no-ff", "--no-edit", branch])
    if (r.ok) return { ok: true }
    const conflicts = (await this.status()).filter((e) => e.conflict).length
    return conflicts ? { conflicts } : { error: firstError(r.err || r.out) }
  }

  /** The staged changes, for the AI commit message. */
  async stagedDiff(maxBytes = 60_000): Promise<string> {
    const r = await this.run(["diff", "--cached", "--no-color", "--no-ext-diff"])
    return r.out.length > maxBytes ? r.out.slice(0, maxBytes) + "\n[diff truncated]" : r.out
  }

  async push(onProgress?: (line: string) => void): Promise<{ ok: true } | { error: string; noUpstream?: boolean; noRemote?: boolean }> {
    const remotes = (await this.run(["remote"])).out.split("\n").filter(Boolean)
    if (!remotes.length) return { error: "No remote configured (git remote add origin <url>)", noRemote: true }
    const upstream = await this.run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
    if (!upstream.ok) return { error: "This branch has no upstream yet", noUpstream: true }
    const r = await this.run(["push", "--progress"], { onErrLine: onProgress, timeoutMs: 120_000 })
    return r.ok ? { ok: true } : { error: firstError(r.err) }
  }

  /** First push of a branch: push it and set its upstream on the first remote. */
  async pushSetUpstream(branch: string, onProgress?: (line: string) => void): Promise<string | null> {
    const remote = (await this.run(["remote"])).out.split("\n").filter(Boolean)[0] ?? "origin"
    const r = await this.run(["push", "--progress", "-u", remote, branch], { onErrLine: onProgress, timeoutMs: 120_000 })
    return r.ok ? null : firstError(r.err)
  }

  async pull(onProgress?: (line: string) => void): Promise<string | null> {
    const remotes = (await this.run(["remote"])).out.split("\n").filter(Boolean)
    if (!remotes.length) return "No remote configured (git remote add origin <url>)"
    const r = await this.run(["pull", "--ff-only", "--progress"], { onErrLine: onProgress, timeoutMs: 120_000 })
    return r.ok ? null : firstError(r.err)
  }

  async branches(): Promise<Branch[]> {
    const r = await this.run(["for-each-ref", "--sort=-committerdate", "--format=%(HEAD)%(refname:short)", "refs/heads"])
    const list = r.out
      .split("\n")
      .filter(Boolean)
      .map((l) => ({ name: l.slice(1), current: l[0] === "*" }))
    // A new repo has no refs yet; still show the branch HEAD points to.
    if (!list.length) {
      const head = (await this.run(["symbolic-ref", "--short", "HEAD"])).out.trim()
      if (head) list.push({ name: head, current: true })
    }
    return list
  }

  async switchTo(name: string): Promise<string | null> {
    const r = await this.run(["switch", name])
    return r.ok ? null : firstError(r.err)
  }

  /**
   * Delete a local branch. Without `force`, git refuses one whose commits aren't merged anywhere;
   * that comes back as `unmerged` so the caller can ask before forcing.
   */
  async deleteBranch(name: string, force = false): Promise<{ ok: true } | { error: string; unmerged?: boolean }> {
    const r = await this.run(["branch", force ? "-D" : "-d", "--", name])
    if (r.ok) return { ok: true }
    return { error: firstError(r.err), unmerged: /not fully merged/i.test(r.err) }
  }

  async createBranch(name: string): Promise<string | null> {
    const r = await this.run(["switch", "-c", name])
    return r.ok ? null : firstError(r.err)
  }

  async blame(path: string, contents?: string): Promise<BlameLine[]> {
    // With --contents, blame what the editor holds (unsaved lines show as not committed).
    const args = ["blame", "--porcelain", ...(contents !== undefined ? ["--contents", "-"] : []), "--", this.rel(path)]
    const r = await this.run(args, contents !== undefined ? { stdin: contents } : undefined)
    return r.ok ? parseBlame(r.out) : []
  }

  async log(path?: string, max = 200): Promise<LogEntry[]> {
    const r = await this.run(["log", `-${max}`, "--format=%h%x1f%an%x1f%ar%x1f%s", ...(path ? ["--follow", "--", this.rel(path)] : [])])
    return r.ok ? parseLog(r.out) : []
  }

  async show(sha: string, path?: string): Promise<string> {
    const r = await this.run(["show", "--no-color", "--stat", "--patch", "--format=commit %H%nAuthor: %an <%ae>%nDate:   %ad%n%n%w(0,4,4)%B", sha, ...(path ? ["--", this.rel(path)] : [])])
    return r.ok ? r.out : firstError(r.err)
  }
}
