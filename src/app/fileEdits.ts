import { decodeUtf8 } from "../editor/fileio"
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
      // Only valid UTF-8 is rewritten (a Latin-1 file would come back with its accents replaced);
      // a byte-order mark stays where it was.
      const bytes = await Bun.file(path)
        .bytes()
        .catch(() => null)
      const text = bytes && decodeUtf8(bytes, true)
      if (text === null || text === undefined) continue
      const after = change(text)
      if (after === text) continue
      await Bun.write(path, after)
    }
    n++
  }
  return n
}
