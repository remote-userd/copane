import { tmpdir } from "node:os"
import { join } from "node:path"
import { shutdown } from "./shutdown"
import { windowFocused } from "./windowFocus"

/**
 * Updating a running editor.
 *
 * `bun run install:cli` replaces the installed binary. A running editor notices (polling the
 * file it was started from) and offers a restart. Restarting saves the open tabs to a small
 * file, exits through the normal shutdown path, and starts the new binary:
 * - Under the installed launcher script (CE_SUPERVISOR_PID set), exit with RESTART_EXIT_CODE
 *   and the launcher starts it again, so restarts never pile up processes.
 * - Otherwise (`bun run dev`, or a binary run directly) spawn the new process ourselves
 *   after the terminal is restored, and pass its exit code through.
 */

const RESTART_EXIT_CODE = 75

export interface RestoreState {
  /** Absolute paths of open tabs, in tab order. */
  files: string[]
  active: string | null
  /** The project folder: `ce` started without one (the welcome page) comes back to it. */
  root?: string
  /** The AI pane's tabs, in order, and the index of the one shown. */
  ai?: { tabs: RestoredTab[]; active: number }
}

/** An AI pane tab to open again: an agent CLI (with its Claude conversation) or a terminal. */
export interface RestoredTab {
  name: string
  command: string
  args: string[]
  cwd: string
  branch: string | null
  worktree?: string
  terminal?: { run?: string }
  claudeSession?: string
}

const isStr = (v: unknown): v is string => typeof v === "string"

function restoredTab(v: unknown): RestoredTab | null {
  if (!v || typeof v !== "object") return null
  const t = v as Record<string, unknown>
  if (!isStr(t.name) || !isStr(t.command) || !isStr(t.cwd) || !Array.isArray(t.args) || !t.args.every(isStr)) return null
  const run = (t.terminal as { run?: unknown } | undefined)?.run
  return {
    name: t.name,
    command: t.command,
    args: t.args,
    cwd: t.cwd,
    branch: isStr(t.branch) ? t.branch : null,
    ...(isStr(t.worktree) ? { worktree: t.worktree } : {}),
    ...(t.terminal && typeof t.terminal === "object" ? { terminal: isStr(run) ? { run } : {} } : {}),
    ...(isStr(t.claudeSession) ? { claudeSession: t.claudeSession } : {}),
  }
}

function restoredAi(v: unknown): RestoreState["ai"] {
  const ai = v as { tabs?: unknown; active?: unknown } | null | undefined
  if (!ai || !Array.isArray(ai.tabs)) return undefined
  const tabs = ai.tabs.map(restoredTab).filter((t): t is RestoredTab => t !== null)
  if (!tabs.length) return undefined
  const active = typeof ai.active === "number" && ai.active >= 0 && ai.active < tabs.length ? ai.active : 0
  return { tabs, active }
}

/** True when running as a `bun build --compile` binary rather than `bun run`. */
export function isCompiled(): boolean {
  return Bun.main.startsWith("/$bunfs/") || Bun.main.startsWith("B:/~BUN/")
}

/** Directory the editor was launched from (main.tsx chdirs to the workspace root). */
let launchCwd = process.cwd()
export function setLaunchCwd(dir: string): void {
  launchCwd = dir
}

function restoreFileFor(pid: string | number): string {
  return join(tmpdir(), `copane-restore-${pid}.json`)
}

/** Read and delete the tabs saved by the previous process, if this start is a restart. */
export async function takeRestoreState(env: Record<string, string | undefined> = Bun.env): Promise<RestoreState | null> {
  const path = env.CE_RESTORE_FILE ?? (env.CE_SUPERVISOR_PID ? restoreFileFor(env.CE_SUPERVISOR_PID) : null)
  if (!path) return null
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  try {
    const data = (await file.json()) as Partial<RestoreState>
    const ai = restoredAi(data.ai)
    return {
      files: Array.isArray(data.files) ? data.files.filter((f): f is string => typeof f === "string") : [],
      active: typeof data.active === "string" ? data.active : null,
      ...(typeof data.root === "string" ? { root: data.root } : {}),
      ...(ai ? { ai } : {}),
    }
  } catch {
    return null
  } finally {
    await file.delete().catch(() => null)
  }
}

/** Shut down cleanly and start the (possibly updated) editor again with the same tabs. */
export async function restart(state: RestoreState): Promise<never> {
  const supervisor = Bun.env.CE_SUPERVISOR_PID
  const file = restoreFileFor(supervisor ?? process.pid)
  await Bun.write(file, JSON.stringify(state))
  if (supervisor) return shutdown(RESTART_EXIT_CODE)
  // `bun run src/main.tsx ...` needs the script path; a compiled binary takes the args directly.
  const cmd = isCompiled() ? [process.execPath, ...process.argv.slice(2)] : [process.execPath, ...process.argv.slice(1)]
  return shutdown(0, async () => {
    const child = Bun.spawn(cmd, {
      cwd: launchCwd,
      env: { ...Bun.env, CE_RESTORE_FILE: file },
      stdio: ["inherit", "inherit", "inherit"],
    })
    return await child.exited
  })
}

async function fingerprint(path: string): Promise<string | null> {
  try {
    const st = await Bun.file(path).stat()
    return `${st.ino}:${st.size}:${st.mtimeMs}`
  } catch {
    return null // mid-install, or removed
  }
}

/**
 * Poll `path` and call `onUpdate` once it has changed and stopped changing (an install in
 * progress is not reported half-written). Returns a stop function.
 */
export function watchForUpdate(path: string, onUpdate: () => void, intervalMs = 2000): () => void {
  let original: string | null | undefined
  let last: string | null = null
  let reported: string | null = null
  let busy = false
  void fingerprint(path).then((f) => {
    original = f
    last = f
  })
  const timer = setInterval(async () => {
    // While you're in another app, wait: the next check after you come back catches the update.
    if (busy || original === undefined || !windowFocused()) return
    busy = true
    const now = await fingerprint(path)
    busy = false
    const stable = now !== null && now === last
    last = now
    if (stable && now !== original && now !== reported) {
      reported = now
      onUpdate()
    }
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
