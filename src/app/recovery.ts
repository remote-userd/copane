/**
 * Unsaved work survives a crash: on an internal error, every dirty buffer's text is copied to
 * ~/.local/state/copane/recovery/<project hash>/, and the next start in that project puts it
 * back (as an undoable change, so Ctrl+Z drops it). Nothing is written while all is well.
 */
import { homedir } from "node:os"
import { join } from "node:path"
import { readdir, rm } from "node:fs/promises"
import type { Workspace } from "./workspace"

interface Saved {
  path: string
  text: string
  savedAt: number
}

export function recoveryDir(root: string): string {
  const base = Bun.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(base, "copane", "recovery", Bun.hash(root).toString(36))
}

/** Copy every dirty buffer's text. Returns how many were saved. Never throws. */
export async function saveRecovery(ws: Workspace, dir = recoveryDir(ws.root)): Promise<number> {
  let n = 0
  for (const buf of ws.buffers.list()) {
    if (buf.kind !== "text" || !buf.dirty) continue
    try {
      const saved: Saved = { path: buf.path, text: ws.buffers.textOf(buf), savedAt: Date.now() }
      await Bun.write(join(dir, `${Bun.hash(buf.path).toString(36)}.json`), JSON.stringify(saved))
      n++
    } catch {
      // keep going: save what can be saved
    }
  }
  return n
}

/** Put back what a crash saved in this project, then forget it. Returns the files restored. */
export async function restoreRecovery(ws: Workspace, dir = recoveryDir(ws.root)): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[])
  const restored: string[] = []
  for (const name of names) {
    const file = join(dir, name)
    try {
      const saved = (await Bun.file(file).json()) as Saved
      if (typeof saved.path !== "string" || typeof saved.text !== "string") continue
      // Saved since the copy was made (the session went on after the error): the copy is old.
      const stat = await Bun.file(saved.path).stat().catch(() => null)
      if (stat && stat.mtimeMs > saved.savedAt) continue
      const buf = await ws.buffers.open(saved.path)
      // The editor mounts on a later frame; until then the text waits in pendingText.
      for (let i = 0; i < 100 && !buf.textarea; i++) await Bun.sleep(10)
      if (buf.textarea && ws.buffers.textOf(buf) !== saved.text) {
        ws.buffers.replaceText(buf, saved.text)
        restored.push(buf.relPath)
      }
    } catch {
      // unreadable, or the file can't be opened any more: drop it
    }
  }
  await rm(dir, { recursive: true, force: true }).catch(() => null)
  return restored
}
