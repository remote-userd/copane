import type { Workspace } from "./workspace"

/**
 * The AI CLI reads files from disk, so unsaved edits are invisible to it. When focus moves to
 * the AI pane, save dirty buffers (except ones in a conflict, which need a decision first).
 */
export function saveBeforeAi(ws: Workspace): () => void {
  let last = ws.ui.get().focus
  return ws.ui.subscribe(() => {
    const focus = ws.ui.get().focus
    const entered = focus === "ai" && last !== "ai"
    last = focus
    if (!entered || !ws.config.editor.saveBeforeAi) return
    const dirty = ws.buffers.list().filter((b) => b.dirty && !b.conflict)
    if (!dirty.length) return
    void Promise.all(dirty.map((b) => ws.buffers.save(b.id).catch(() => null))).then((saved) => {
      const n = saved.filter(Boolean).length
      if (n) ws.notify(`Saved ${n === 1 ? dirty[0]!.relPath : `${n} files`} so the AI sees your changes`)
    })
  })
}
