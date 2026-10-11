import { watch, type FSWatcher } from "node:fs"
import { dirname, join, sep } from "node:path"
import { HARD_EXCLUDES, IgnoreMatcher } from "./ignore"
import { crawl } from "./walk"

export interface ChangeBatch {
  /** Absolute paths reported by the OS. */
  paths: Set<string>
  /** Their parent directories. Atomic saves (write temp + rename) only report the temp name, so consumers re-check files in these. */
  dirs: Set<string>
}

/**
 * Debounced workspace watcher. Watches each folder that matters on its own (not recursively):
 * a recursive watch registers every folder with the OS, including node_modules and .git,
 * which in big repositories means tens of thousands of watches the editor ignores anyway.
 * Folders are skipped when ignored (HARD_EXCLUDES and .gitignore, via the tree's matcher).
 */
export class FileWatcher {
  private watchers = new Map<string, FSWatcher>()
  private pending = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  /** Stops adding folders past this; very large trees still work, minus far-away events. */
  static MAX_DIRS = 20_000
  limitHit = false

  constructor(
    private root: string,
    private onBatch: (batch: ChangeBatch) => void,
    private debounceMs = 100,
    private matcher: IgnoreMatcher = new IgnoreMatcher(root),
  ) {}

  /** Resolves once the initial folders are watched. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.addTree(this.root)
  }

  get watchedDirs(): number {
    return this.watchers.size
  }

  private async addTree(dir: string): Promise<void> {
    await crawl(
      dir,
      this.matcher,
      (d) => this.started && this.watchDir(d),
      (e) => !HARD_EXCLUDES.has(e.name),
    )
  }

  private watchDir(dir: string): boolean {
    if (this.watchers.has(dir)) return true
    if (this.watchers.size >= FileWatcher.MAX_DIRS) {
      this.limitHit = true
      return false
    }
    try {
      const w = watch(dir, (_event, filename) => {
        if (!filename) return
        const name = filename.toString()
        if (HARD_EXCLUDES.has(name)) return
        this.pending.add(join(dir, name))
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.flush(), this.debounceMs)
      })
      // A removed folder: forget its watcher.
      w.on("error", () => this.unwatch(dir))
      this.watchers.set(dir, w)
    } catch {
      // vanished or unreadable
    }
    return true
  }

  private unwatch(dir: string): void {
    for (const [d, w] of this.watchers) {
      if (d === dir || d.startsWith(dir + sep)) {
        w.close()
        this.watchers.delete(d)
      }
    }
  }

  private async flush(): Promise<void> {
    this.timer = null
    if (this.pending.size === 0) return
    const paths = this.pending
    this.pending = new Set()
    // New folders start being watched; removed ones are dropped.
    for (const p of paths) {
      const info = await Bun.file(p).stat().catch(() => null)
      if (info?.isDirectory()) {
        if (!this.watchers.has(p) && !this.matcher.isIgnored(p, true)) await this.addTree(p)
      } else if (!info && this.watchers.has(p)) this.unwatch(p)
    }
    const dirs = new Set([...paths].map((p) => dirname(p)))
    this.onBatch({ paths, dirs })
  }

  stop(): void {
    this.started = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const w of this.watchers.values()) w.close()
    this.watchers.clear()
  }
}

/** Which open files a batch may have touched. */
export function affectedOpenFiles(batch: ChangeBatch, openPaths: Iterable<string>): string[] {
  const out: string[] = []
  for (const p of openPaths) {
    if (batch.paths.has(p) || batch.dirs.has(dirname(p)) || [...batch.paths].some((c) => p.startsWith(c + sep))) out.push(p)
  }
  return out
}
