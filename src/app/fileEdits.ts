import type { Workspace } from "./workspace"

/**
 * Rewrite files: open buffers in place (one undo step each, left unsaved), others on disk.
 * Returns how many files changed.
 */
export async function applyToFiles(ws: Workspace, files: Map<string, (text: string) => string>): Promise<number> {
  let n = 0
  for (const [path, change] of files) {
    const buf = ws.buffers.byPath(path)
    const ta = buf?.textarea
    if (buf && ta) {
      const before = ta.plainText
      const after = change(before)
      if (after === before) continue
      ws.buffers.replaceText(buf, after)
    } else {
      const text = await Bun.file(path).text().catch(() => null)
      if (text === null) continue
      const after = change(text)
      if (after === text) continue
      await Bun.write(path, after)
    }
    n++
  }
  return n
}
