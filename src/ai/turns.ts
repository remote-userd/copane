/**
 * What the AI changed, turn by turn, so a whole turn (or one file, or one change) can be reviewed
 * and undone.
 *
 * A turn starts when you submit a prompt while the AI is idle (answering an approval mid-turn
 * doesn't start a new one) and ends when the AI goes quiet. At the start the working tree is
 * snapshotted cheaply with `git stash create` (it writes an object; files, index and stash list
 * are untouched), plus the contents of untracked files, so each changed file's "before" is exact.
 * Outside git, an open tab's last known disk text is the fallback. Binary files can't be undone.
 */
import { relative } from "node:path"
import { Store } from "../app/store"
import type { GitRepo } from "../git/repo"
import { hunks, revertHunk } from "../editor/hunks"

export interface TurnFile {
  path: string
  /** Content before the turn; null when the file didn't exist. */
  before: string | null
  /** False when the content before is unknown (binary, ignored by git, no git): no undo. */
  known: boolean
  /** Hash of the content when the turn ended (set then), to tell whether it has been edited since. */
  afterHash?: string | null
}

export interface Turn {
  id: number
  startedAt: number
  endedAt: number | null
  /** What you asked, as far as it could be read from your typing. */
  prompt: string
  files: TurnFile[]
}

interface Snapshot {
  sha: string | null
  /** Untracked files at the start, by path, with their contents (small text files only). */
  untracked: Map<string, string | null>
}

const MAX_TURNS = 30
const MAX_UNTRACKED_BYTES = 1_000_000
/** A file's "before" bigger than this isn't kept (a lockfile, a bundle): its turn can't undo it. */
const MAX_FILE_BYTES = 1_000_000
const hashOf = (text: string | null) => (text === null ? null : Bun.hash(text).toString(36))

export class TurnLog {
  readonly store = new Store<{ turns: Turn[] }>({ turns: [] })
  private current: Turn | null = null
  private snapshot: Promise<Snapshot> | null = null
  private nextId = 1
  /** Paths copane itself just wrote (undo), with the content, so they aren't counted as AI edits. */
  private ownWrites = new Map<string, string | null>()

  constructor(
    private root: string,
    private repo: () => GitRepo | null,
    private untrackedFiles: () => Promise<string[]> = async () => [],
  ) {}

  get turns(): Turn[] {
    return this.store.get().turns
  }

  get open(): boolean {
    return this.current !== null
  }

  /**
   * You submitted a prompt. Starts a turn unless one is still running. Resolves once the "before"
   * snapshot is taken (tens of milliseconds; the AI's first edit comes long after).
   */
  async begin(prompt: string, now = Date.now()): Promise<void> {
    if (this.current) return
    this.current = { id: this.nextId++, startedAt: now, endedAt: null, prompt: prompt.trim(), files: [] }
    this.snapshot = this.takeSnapshot()
    await this.snapshot
  }

  /** The AI went quiet (not waiting on a question): the turn is over. Turns that changed nothing are dropped. */
  end(now = Date.now()): Promise<void> {
    const turn = this.current
    if (!turn) return Promise.resolve()
    this.current = null
    this.snapshot = null
    if (!turn.files.length) return Promise.resolve()
    turn.endedAt = now
    this.publish()
    return Promise.all(turn.files.map(async (f) => (f.afterHash = hashOf(await this.contentNow(f.path))))).then(() => {})
  }

  /**
   * A file changed on disk (not by copane). `hint` is an open tab's last known disk text, used
   * when git can't say what the file held before.
   */
  async fileChanged(path: string, hint?: string): Promise<void> {
    const turn = this.current
    if (!turn) return
    if (this.ownWrites.has(path)) {
      const expected = this.ownWrites.get(path)
      const now = await Bun.file(path).text().catch(() => null)
      if (now === expected) return void this.ownWrites.delete(path)
    }
    if (turn.files.some((f) => f.path === path)) return // the first "before" is the one that counts
    const snap = await this.snapshot
    const file = await this.before(path, snap, hint)
    // Neither there before nor now (a temp file of an atomic save, a removed folder): nothing to undo.
    if (file.known && file.before === null && !(await Bun.file(path).exists())) return
    if (turn.files.some((f) => f.path === path)) return
    turn.files.push(file)
    this.publish()
  }

  /** What a file holds now (null when it's gone). */
  async contentNow(path: string): Promise<string | null> {
    return Bun.file(path)
      .text()
      .catch(() => null)
  }

  /** Files of a turn changed since it ended (by you or a later turn): undoing would drop those edits. */
  async editedSince(turn: Turn): Promise<string[]> {
    const out: string[] = []
    for (const f of turn.files) if (f.afterHash !== undefined && hashOf(await this.contentNow(f.path)) !== f.afterHash) out.push(f.path)
    return out
  }

  /** Put files back as they were before the turn. Returns how many were restored. */
  async undo(turn: Turn, paths?: string[]): Promise<number> {
    let n = 0
    for (const f of turn.files) {
      if (!f.known || (paths && !paths.includes(f.path))) continue
      this.expectOwnWrite(f.path, f.before)
      if (f.before === null) await Bun.file(f.path).delete().catch(() => null)
      else await Bun.write(f.path, f.before)
      n++
    }
    return n
  }

  /** Undo one change (hunk) of a file: the lines go back to what they were before the turn. */
  async undoHunk(file: TurnFile, index: number): Promise<boolean> {
    if (!file.known || file.before === null) return false
    const now = await this.contentNow(file.path)
    if (now === null) return false
    const h = hunks(file.before, now)[index]
    if (!h) return false
    const next = revertHunk(now, h)
    this.expectOwnWrite(file.path, next)
    await Bun.write(file.path, next)
    return true
  }

  /**
   * copane is about to write this content (an undo): when the watcher reports it, it isn't the
   * AI's. Forgotten after a while, so an old entry can't hide a later AI write of the same text.
   */
  private expectOwnWrite(path: string, content: string | null): void {
    this.ownWrites.set(path, content)
    setTimeout(() => {
      if (this.ownWrites.get(path) === content) this.ownWrites.delete(path)
    }, 10_000).unref?.()
  }

  private publish(): void {
    const done = this.turns.filter((t) => t.endedAt !== null && t !== this.current)
    const list = this.current && this.current.files.length ? [...done, this.current] : done
    this.store.set({ turns: list.slice(-MAX_TURNS) })
  }

  private async takeSnapshot(): Promise<Snapshot> {
    const repo = this.repo()
    const untracked = new Map<string, string | null>()
    if (!repo) return { sha: null, untracked }
    const [sha, files] = await Promise.all([repo.snapshot().catch(() => null), this.untrackedFiles().catch(() => [])])
    let total = 0
    for (const p of files) {
      const f = Bun.file(p)
      const size = f.size
      if (total + size > MAX_UNTRACKED_BYTES) {
        untracked.set(p, null)
        continue
      }
      total += size
      const text = await f.text().catch(() => null)
      untracked.set(p, text !== null && !text.includes("\0") ? text : null)
    }
    return { sha, untracked }
  }

  private async before(path: string, snap: Snapshot | null, hint: string | undefined): Promise<TurnFile> {
    const unknown = { path, before: null, known: false }
    const repo = this.repo()
    if (repo && snap?.untracked.has(path)) {
      const text = snap.untracked.get(path)!
      return text === null ? unknown : { path, before: text, known: true }
    }
    // Without a commit to compare with (a repo before its first commit), git can't say what a
    // tracked file held: fall back as without git, so a staged file is never taken for a new one.
    if (repo && snap?.sha) {
      const atStart = await repo.showAt(snap.sha, path)
      if (atStart !== null) return atStart.includes("\0") || atStart.length > MAX_FILE_BYTES ? unknown : { path, before: atStart, known: true }
      // Not tracked, not untracked: new in this turn, unless git ignores it (then we can't tell).
      if (await repo.isIgnored(path)) return hint !== undefined ? { path, before: hint, known: true } : unknown
      return { path, before: null, known: true }
    }
    return hint !== undefined && !hint.includes("\0") && hint.length <= MAX_FILE_BYTES ? { path, before: hint, known: true } : unknown
  }
}

/** "src/a.ts" for display. */
export const relTo = (root: string, path: string) => relative(root, path) || path
