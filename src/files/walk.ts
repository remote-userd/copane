import { readdir } from "node:fs/promises"
import { relative, sep } from "node:path"
import { HARD_EXCLUDES, IgnoreMatcher } from "./ignore"

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  /** Matched by .gitignore: only listed when asked for (the tree shows these faded). */
  ignored?: boolean
}

/** Sorted, ignore-filtered entries of one directory: folders first, then files. `withIgnored` keeps .gitignored ones, flagged. */
export async function listDir(dir: string, matcher: IgnoreMatcher, withIgnored = false): Promise<DirEntry[]> {
  let dirents
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  matcher.noteListing(dir, dirents.some((d) => d.name === ".gitignore"))
  const out: DirEntry[] = []
  const prefix = dir.endsWith(sep) ? dir : dir + sep
  for (const d of dirents) {
    const path = prefix + d.name
    const isDir = d.isDirectory()
    if (!isDir && !d.isFile() && !d.isSymbolicLink()) continue
    if (HARD_EXCLUDES.has(d.name)) continue
    if (matcher.isIgnored(path, isDir)) {
      if (withIgnored) out.push({ name: d.name, path, isDir, ignored: true })
      continue
    }
    out.push({ name: d.name, path, isDir })
  }
  return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
}

export interface WalkResult {
  /** Root-relative file paths with forward slashes. */
  files: string[]
  truncated: boolean
}

/** Breadth-first list of every non-ignored file, capped for huge trees. */
export async function walkFiles(root: string, matcher: IgnoreMatcher, limit = 50_000): Promise<WalkResult> {
  const files: string[] = []
  const prefix = root.length + 1
  await crawl(root, matcher, (_dir, entries) => {
    for (const e of entries) {
      if (e.isDir) continue
      files.push(sep === "/" ? e.path.slice(prefix) : relative(root, e.path).split(sep).join("/"))
      if (files.length >= limit) return false
    }
    return true
  })
  return { files, truncated: files.length >= limit }
}

/**
 * Breadth-first listing of every non-ignored folder under root, reading several folders at a
 * time (one at a time is slow on big trees) but reporting them in a stable order. `visit`
 * returns false to stop; folders it should not descend into can be filtered with `descend`.
 */
export async function crawl(
  root: string,
  matcher: IgnoreMatcher,
  visit: (dir: string, entries: DirEntry[]) => boolean,
  descend: (entry: DirEntry) => boolean = () => true,
  parallel = 16,
): Promise<void> {
  let level = [root]
  while (level.length) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += parallel) {
      const batch = level.slice(i, i + parallel)
      const listings = await Promise.all(batch.map((d) => listDir(d, matcher)))
      for (let j = 0; j < batch.length; j++) {
        if (!visit(batch[j]!, listings[j]!)) return
        for (const e of listings[j]!) if (e.isDir && descend(e)) next.push(e.path)
      }
    }
    level = next
  }
}
