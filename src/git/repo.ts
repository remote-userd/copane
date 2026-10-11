import { join, relative, sep } from "node:path"

/** Git operations for the editor. Every call runs `git` in the repository's top folder. */

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
      env: { ...Bun.env, GIT_TERMINAL_PROMPT: "0", ...opts.env },
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
    const r = await this.run(["status", "--porcelain=v1", "-z", "-uall"])
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
