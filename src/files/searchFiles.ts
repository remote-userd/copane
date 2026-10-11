import { join, relative, sep } from "node:path"
import { isCaseSensitive } from "../editor/search"

export interface Hit {
  path: string
  rel: string
  /** 0-based line; display columns of the first match on that line. */
  line: number
  startCol: number
  endCol: number
  /** The line (trimmed to a sane length) and the match's string indexes in it. */
  text: string
  start: number
  end: number
}

export interface SearchResult {
  hits: Hit[]
  truncated: boolean
  engine: "rg" | "builtin"
}

/** Search toggles, as in VS Code: Alt+C case, Alt+W whole word, Alt+R regex. Case is smart unless set. */
export interface MatchOptions {
  regex?: boolean
  wholeWord?: boolean
  caseSensitive?: boolean
}

export interface SearchOptions {
  limit?: number
  signal?: AbortSignal
  files?: () => Promise<string[]>
  rg?: string | null
  match?: MatchOptions
  /** ripgrep-style globs: "src/**" includes, "!*.test.ts" excludes. */
  globs?: string[]
}

const MAX_LINE = 300

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** A global RegExp for the query, or an error message (an invalid regex). */
export function matcherFor(query: string, match: MatchOptions = {}): RegExp | string {
  const sensitive = match.caseSensitive ?? isCaseSensitive(query)
  let source = match.regex ? query : escapeRegex(query)
  if (match.wholeWord) source = `\\b(?:${source})\\b`
  try {
    return new RegExp(source, sensitive ? "g" : "gi")
  } catch (err) {
    return (err as Error).message.replace(/^Invalid regular expression: /, "")
  }
}

/** Split the "files to include" field: comma-separated globs, "!" excludes. */
export function parseGlobs(field: string): string[] {
  return field
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean)
}

/** Whether a project-relative path passes the globs (a bare name like "src" also matches inside it). */
export function globsAllow(rel: string, globs: string[]): boolean {
  const test = (g: string) => new Bun.Glob(g).match(rel) || new Bun.Glob(`**/${g}`).match(rel) || new Bun.Glob(`**/${g}/**`).match(rel)
  const include = globs.filter((g) => !g.startsWith("!"))
  const exclude = globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1))
  if (include.length && !include.some(test)) return false
  return !exclude.some(test)
}

function firstMatch(raw: string, re: RegExp): { start: number; end: number } | null {
  re.lastIndex = 0
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    if (m[0].length) return { start: m.index, end: m.index + m[0].length }
    re.lastIndex++
  }
  return null
}

function hitFromLine(root: string, path: string, line: number, raw: string, re: RegExp): Hit | null {
  const m = firstMatch(raw, re)
  if (!m) return null
  const text = raw.length > MAX_LINE ? raw.slice(0, MAX_LINE) : raw
  const startCol = Bun.stringWidth(raw.slice(0, m.start))
  const endCol = startCol + Bun.stringWidth(raw.slice(m.start, m.end))
  return { path, rel: relative(root, path).split(sep).join("/"), line, startCol, endCol, text, ...m }
}

function rgArgs(rg: string, query: string, match: MatchOptions, globs: string[]): string[] {
  const args = [rg, "--color=never", "--max-filesize=1M"]
  if (!match.regex) args.push("--fixed-strings")
  if (match.wholeWord) args.push("--word-regexp")
  const sensitive = match.caseSensitive ?? isCaseSensitive(query)
  args.push(sensitive ? "--case-sensitive" : "--ignore-case")
  for (const g of globs) {
    args.push("--glob", g)
    // A bare folder name ("src", "!dist") means everything inside it, as in VS Code.
    if (!/[*?[{]/.test(g)) args.push("--glob", `${g.replace(/\/$/, "")}/**`)
  }
  return args
}

/** ripgrep: fast, honours .gitignore. */
async function withRg(rg: string, root: string, query: string, re: RegExp, opts: SearchOptions, limit: number): Promise<SearchResult> {
  const args = [...rgArgs(rg, query, opts.match ?? {}, opts.globs ?? []), "--line-number", "--no-heading", "--max-count=100", "-0", "--", query, "."]
  const proc = Bun.spawn(args, { cwd: root, stdout: "pipe", stderr: "ignore", stdin: "ignore" })
  opts.signal?.addEventListener("abort", () => proc.kill())
  const hits: Hit[] = []
  let truncated = false
  let rest = ""
  const decoder = new TextDecoder()
  for await (const chunk of proc.stdout) {
    rest += decoder.decode(chunk, { stream: true })
    let nl: number
    while ((nl = rest.indexOf("\n")) !== -1) {
      const row = rest.slice(0, nl)
      rest = rest.slice(nl + 1)
      // -0 puts a NUL after the path, so paths may contain ':'.
      const z = row.indexOf("\0")
      const colon = row.indexOf(":", z + 1)
      if (z < 0 || colon < 0) continue
      const file = row.slice(0, z).replace(/^\.\//, "")
      const line = Number(row.slice(z + 1, colon)) - 1
      const hit = hitFromLine(root, join(root, file), line, row.slice(colon + 1), re)
      if (hit) hits.push(hit)
      if (hits.length >= limit) {
        truncated = true
        proc.kill()
        break
      }
    }
    if (truncated) break
  }
  await proc.exited
  return { hits, truncated, engine: "rg" }
}

async function readText(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path)
    if (file.size > 1_000_000) return null
    const bytes = await file.bytes()
    if (bytes.includes(0)) return null
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/** Fallback without ripgrep: scan the tree's (ignore-filtered) file list. */
async function builtin(root: string, files: string[], re: RegExp, opts: SearchOptions, limit: number): Promise<SearchResult> {
  const hits: Hit[] = []
  const globs = opts.globs ?? []
  for (const rel of files) {
    if (opts.signal?.aborted) break
    if (globs.length && !globsAllow(rel, globs)) continue
    const path = join(root, rel)
    const text = await readText(path)
    if (text === null) continue
    let perFile = 0
    const lines = text.split("\n")
    for (let line = 0; line < lines.length && perFile < 100; line++) {
      const hit = hitFromLine(root, path, line, lines[line]!, re)
      if (!hit) continue
      hits.push(hit)
      perFile++
      if (hits.length >= limit) return { hits, truncated: true, engine: "builtin" }
    }
  }
  return { hits, truncated: false, engine: "builtin" }
}

export async function searchFiles(root: string, query: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const limit = opts.limit ?? 500
  const re = matcherFor(query, opts.match)
  if (typeof re === "string") return { hits: [], truncated: false, engine: "builtin" }
  const rg = opts.rg === undefined ? Bun.which("rg") : opts.rg
  if (rg) return withRg(rg, root, query, re, opts, limit)
  return builtin(root, (await opts.files?.()) ?? [], re, opts, limit)
}

/** Every file (absolute path) with at least one match: no hit or per-file caps. */
async function matchingFiles(root: string, query: string, re: RegExp, opts: SearchOptions): Promise<string[]> {
  const rg = opts.rg === undefined ? Bun.which("rg") : opts.rg
  if (rg) {
    const proc = Bun.spawn([...rgArgs(rg, query, opts.match ?? {}, opts.globs ?? []), "--files-with-matches", "-0", "--", query, "."], {
      cwd: root,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    })
    const out = await Bun.readableStreamToText(proc.stdout)
    await proc.exited
    return out
      .split("\0")
      .filter(Boolean)
      .map((f) => join(root, f.replace(/^\.\//, "")))
  }
  const out: string[] = []
  for (const rel of (await opts.files?.()) ?? []) {
    if (opts.globs?.length && !globsAllow(rel, opts.globs)) continue
    const text = await readText(join(root, rel))
    re.lastIndex = 0
    if (text !== null && re.test(text)) out.push(join(root, rel))
    re.lastIndex = 0
  }
  return out
}

/** Replace in `text`: `$1` and friends work in regex mode; elsewhere the replacement is literal. */
export function replaceAllIn(text: string, re: RegExp, replacement: string, regex: boolean): { text: string; count: number } {
  let count = 0
  re.lastIndex = 0 // matchAll starts from it, and the regex is shared
  for (const m of text.matchAll(re)) if (m[0].length) count++
  if (!count) return { text, count }
  return { text: regex ? text.replace(re, replacement) : text.replace(re, () => replacement), count }
}

/**
 * Replace line by line (search is line-based, like ripgrep), leaving `skip` lines alone.
 * With `only`, just the first match on that one line (the match a hit row shows).
 */
export function replaceLines(
  text: string,
  re: RegExp,
  replacement: string,
  regex: boolean,
  opts: { skip?: Set<number>; only?: number } = {},
): { text: string; count: number } {
  const lines = text.split("\n")
  let count = 0
  for (let i = 0; i < lines.length; i++) {
    if (opts.skip?.has(i) || (opts.only !== undefined && i !== opts.only)) continue
    if (opts.only !== undefined) {
      const m = firstMatch(lines[i]!, re)
      if (!m) continue
      const one = new RegExp(re.source, re.flags.replace("g", ""))
      const matched = lines[i]!.slice(m.start, m.end)
      const by = regex ? matched.replace(one, replacement) : replacement
      lines[i] = lines[i]!.slice(0, m.start) + by + lines[i]!.slice(m.end)
      count++
      continue
    }
    const r = replaceAllIn(lines[i]!, re, replacement, regex)
    lines[i] = r.text
    count += r.count
  }
  return { text: lines.join("\n"), count }
}

/**
 * Plan a project-wide replace: for each matching file, a function from its current text (the
 * open buffer's, or the disk's) to the replaced text. Applying it is up to the caller.
 * `skip` holds lines (per absolute path) the user dismissed from the results.
 */
export async function replaceInFiles(
  root: string,
  query: string,
  replacement: string,
  opts: SearchOptions & { skip?: Map<string, Set<number>> } = {},
): Promise<Map<string, (text: string) => string> | string> {
  const re = matcherFor(query, opts.match)
  if (typeof re === "string") return re
  const regex = !!opts.match?.regex
  const out = new Map<string, (text: string) => string>()
  for (const path of await matchingFiles(root, query, re, opts))
    out.set(path, (text) => replaceLines(text, re, replacement, regex, { skip: opts.skip?.get(path) }).text)
  return out
}
