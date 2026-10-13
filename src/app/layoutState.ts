import { homedir } from "node:os"
import { join } from "node:path"
import type { UiState } from "./state"
import type { Store } from "./store"

/** Pane widths the user dragged and "maximize AI", remembered across sessions (~/.local/state/copane/layout.json). */
type Layout = Pick<UiState, "treeWidth" | "aiWidth" | "aiMaximized" | "treeVisible">

function layoutPath(): string {
  const base = Bun.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(base, "copane", "layout.json")
}

export async function loadLayout(path = layoutPath()): Promise<Partial<Layout>> {
  try {
    const raw = (await Bun.file(path).json()) as Record<string, unknown>
    const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1000 ? v : null)
    const widths = { treeWidth: num(raw.treeWidth), aiWidth: num(raw.aiWidth) }
    // Started in "maximize AI": the tree comes back when it ends.
    return raw.aiMaximized === true ? { ...widths, aiMaximized: { tree: true }, treeVisible: false } : widths
  } catch {
    return {}
  }
}

const saved = (s: UiState) => JSON.stringify({ treeWidth: s.treeWidth, aiWidth: s.aiWidth, aiMaximized: !!s.aiMaximized })

/** Save the layout whenever a drag ends or "maximize AI" toggles. Returns an unsubscribe function. */
export function persistLayout(ui: Store<UiState>, path = layoutPath()): () => void {
  let last = saved(ui.get())
  return ui.subscribe(() => {
    const s = ui.get()
    if (s.resizing) return
    const next = saved(s)
    if (next === last) return
    last = next
    // Bun.write creates the folder; a failure is not worth interrupting anyone over.
    void Bun.write(path, next + "\n").catch(() => null)
  })
}
