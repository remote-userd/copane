import { readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import ignore, { type Ignore } from "ignore"

/** Always hidden, regardless of .gitignore. */
export const HARD_EXCLUDES = new Set([".git", "node_modules", ".DS_Store"])

/**
 * Answers "is this path ignored?" honouring every .gitignore from the root down.
 * Each directory's rules are loaded once and cached.
 */
export class IgnoreMatcher {
  private cache = new Map<string, Ignore | null>()
  /** Folders already checked: everything inside an ignored folder is ignored too. */
  private ignoredDirs = new Map<string, boolean>()
  private readonly prefix: string
  constructor(readonly root: string) {
    this.prefix = root.endsWith(sep) ? root : root + sep
  }

  private rulesFor(dir: string): Ignore | null {
    if (this.cache.has(dir)) return this.cache.get(dir)!
    let ig: Ignore | null = null
    try {
      const text = readFileSync(join(dir, ".gitignore"), "utf8")
      ig = ignore().add(text)
    } catch {
      ig = null
    }
    this.cache.set(dir, ig)
    return ig
  }

  /** A folder was just listed: when it has no .gitignore there is nothing to read (or fail to read). */
  noteListing(dir: string, hasGitignore: boolean): void {
    if (!hasGitignore && !this.cache.has(dir)) this.cache.set(dir, null)
  }

  invalidate(dir?: string): void {
    if (dir) this.cache.delete(dir)
    else this.cache.clear()
    this.ignoredDirs.clear()
  }

  /** absPath must be inside root. */
  isIgnored(absPath: string, isDir: boolean): boolean {
    if (!absPath.startsWith(this.prefix)) return false
    const parts = absPath.slice(this.prefix.length).split(sep)
    if (parts.some((p) => HARD_EXCLUDES.has(p))) return true
    if (parts.length > 1) {
      const parent = absPath.slice(0, absPath.length - parts.at(-1)!.length - 1)
      let hidden = this.ignoredDirs.get(parent)
      if (hidden === undefined) this.ignoredDirs.set(parent, (hidden = this.isIgnored(parent, true)))
      if (hidden) return true
    }
    // The path itself against each ancestor's rules, relative to that folder ("dist/" matches folders only).
    // Ancestors are prefixes of the path itself: slice them out rather than joining per entry.
    let end = this.prefix.length
    for (let i = 0; i < parts.length; i++) {
      const ig = this.rulesFor(i === 0 ? this.root : absPath.slice(0, end - 1))
      if (ig?.ignores(parts.slice(i).join("/") + (isDir ? "/" : ""))) return true
      end += parts[i]!.length + 1
    }
    return false
  }
}
