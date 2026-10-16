import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Recently opened project folders, newest first (~/.local/state/copane/recent.json), for the
 * welcome page and Open Recent Folder. A broken or missing file is an empty list.
 */

export interface RecentFolder {
  path: string
  openedAt: number
}

export const MAX_RECENT = 20

export function recentPath(): string {
  const base = Bun.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(base, "copane", "recent.json")
}

async function read(file: string): Promise<RecentFolder[]> {
  try {
    const raw = (await Bun.file(file).json()) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((r): r is RecentFolder => typeof r?.path === "string" && typeof r?.openedAt === "number")
  } catch {
    return []
  }
}

async function write(list: RecentFolder[], file: string): Promise<void> {
  try {
    await Bun.write(file, JSON.stringify(list.slice(0, MAX_RECENT), null, 1))
  } catch {
    // Read-only home or full disk: the list just doesn't update.
  }
}

/** The recent folders that still exist. */
export async function loadRecent(file = recentPath()): Promise<RecentFolder[]> {
  const list = await read(file)
  const there = await Promise.all(
    list.map((r) =>
      Bun.file(r.path)
        .stat()
        .then((s) => s.isDirectory())
        .catch(() => false),
    ),
  )
  return list.filter((_, i) => there[i])
}

/** A folder was opened: it moves to the top. */
export async function recordRecent(path: string, file = recentPath(), now = Date.now()): Promise<void> {
  const list = (await read(file)).filter((r) => r.path !== path)
  await write([{ path, openedAt: now }, ...list], file)
}

export async function forgetRecent(path: string, file = recentPath()): Promise<void> {
  await write(
    (await read(file)).filter((r) => r.path !== path),
    file,
  )
}

/** "~/code/app" for display. */
export function tildify(path: string, home = homedir()): string {
  return path === home ? "~" : path.startsWith(home + "/") ? "~" + path.slice(home.length) : path
}
