/**
 * New releases, like Claude Code's auto-update: once a day the installed binary asks GitHub for
 * the latest release. With `update: "auto"` (the default) a newer one is installed in the
 * background, the same way `copane --upgrade` does; the binary watcher (update.ts) then shows
 * "Update installed: restart", and the next start runs it anyway. With "notify" the status bar
 * only says one is out. "off" never checks. A failed install (no permission) falls back to
 * notifying. Running from source (`bun run dev`) never checks.
 */
import { homedir } from "node:os"
import { join } from "node:path"
import { isNewer } from "../setup/upgrade"

export type UpdateMode = "auto" | "notify" | "off"
export type CheckResult = "skipped" | "current" | "installed" | "available" | "failed" | "offline"

const DAY_MS = 24 * 60 * 60 * 1000

export interface UpdateDeps {
  current: string
  latest: () => Promise<string>
  install: (tag: string) => Promise<void>
  now?: () => number
  /** Shared by every open editor, so one check a day is enough for all of them. */
  statePath?: string
}

export function updateStatePath(): string {
  const base = Bun.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(base, "copane", "update.json")
}

/**
 * One check, if the last one (by any editor) was more than a day ago. Reports through `on`:
 * a release that's available (notify mode, or a failed install) or installed.
 */
export async function checkForUpdate(
  mode: UpdateMode,
  deps: UpdateDeps,
  on: { available?: (tag: string, why?: string) => void; installed?: (tag: string) => void } = {},
): Promise<CheckResult> {
  if (mode === "off") return "skipped"
  const now = (deps.now ?? Date.now)()
  const statePath = deps.statePath ?? updateStatePath()
  const state = (await Bun.file(statePath)
    .json()
    .catch(() => ({}))) as { lastCheck?: number }
  if (typeof state.lastCheck === "number" && now - state.lastCheck < DAY_MS) return "skipped"
  let tag: string
  try {
    tag = await deps.latest()
  } catch {
    return "offline" // no network, GitHub down: try again next time, quietly
  }
  await Bun.write(statePath, JSON.stringify({ lastCheck: now, latest: tag })).catch(() => null)
  if (!isNewer(tag, deps.current)) return "current"
  if (mode === "notify") {
    on.available?.(tag)
    return "available"
  }
  try {
    await deps.install(tag)
    on.installed?.(tag)
    return "installed"
  } catch (err) {
    on.available?.(tag, (err as Error).message)
    return "failed"
  }
}

/** Check shortly after startup, then every few hours (each check still waits a day since the last). */
export function startAutoUpdate(mode: UpdateMode, deps: UpdateDeps, on: Parameters<typeof checkForUpdate>[2]): () => void {
  if (mode === "off") return () => {}
  const run = () => void checkForUpdate(mode, deps, on).catch(() => null)
  const first = setTimeout(run, 15_000)
  const again = setInterval(run, 6 * 60 * 60 * 1000)
  first.unref?.()
  again.unref?.()
  return () => {
    clearTimeout(first)
    clearInterval(again)
  }
}
