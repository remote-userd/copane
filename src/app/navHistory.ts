import type { CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import type { Buffer } from "../editor/BufferStore"
import type { Workspace } from "./workspace"
import { modalChanged } from "./modalStack"

/**
 * Where you were before each jump (go to definition, search result, go to line, opening a
 * file), so Ctrl+Alt+← / → can step back and forth like a browser.
 */
interface Spot {
  path: string
  row: number
  col: number
}

const back: Spot[] = []
const forward: Spot[] = []
const LIMIT = 100

function here(ws: Workspace): Spot | null {
  const buf = ws.buffers.active
  const ta = buf?.textarea
  if (!buf || !ta) return null
  const { row, col } = ta.logicalCursor
  return { path: buf.path, row, col }
}

const same = (a: Spot | undefined, b: Spot) => !!a && a.path === b.path && Math.abs(a.row - b.row) < 3

/** Call before jumping somewhere: remembers the current spot. */
export function recordJump(ws: Workspace): void {
  const spot = here(ws)
  if (!spot || same(back.at(-1), spot)) return
  back.push(spot)
  if (back.length > LIMIT) back.shift()
  forward.length = 0
}

/**
 * Open a file in the editor and focus it. A file that can't be opened (binary, unreadable, gone)
 * is a notice, not an error: callers fire and forget this from lists and links.
 */
export async function openFile(ws: Workspace, path: string): Promise<Buffer | null> {
  try {
    const buf = await ws.buffers.open(path)
    ws.ui.set({ focus: "editor" })
    return buf
  } catch (err) {
    ws.notify(err instanceof Error ? err.message : String(err), "warn")
    return null
  }
}

/** Open a file and select a range once its editor exists (it mounts on the next render). */
export async function openAt(
  ws: Workspace,
  path: string,
  line: number,
  startCol: number,
  endCol: number,
  opts: { record?: boolean } = {},
): Promise<void> {
  // A jump: remember where we were so Ctrl+Alt+← comes back here.
  if (opts.record !== false) recordJump(ws)
  const before = ws.ui.get().modal
  const buf = await openFile(ws, path)
  if (!buf) return
  // The dialog the jump came from closes; one opened while the file loaded stays.
  if (!modalChanged(ws, before)) ws.ui.set({ modal: null })
  for (let i = 0; i < 40; i++) {
    const ed = ws.buffers.byId(buf.id)?.textarea as CodeEditorRenderable | null | undefined
    if (ed && !ed.isDestroyed && ed.lineCount > line) {
      ed.selectRange(line, startCol, endCol)
      ws.buffers.onCursorChange(buf.id)
      return
    }
    await Bun.sleep(25)
  }
}

function goTo(ws: Workspace, spot: Spot): Promise<void> {
  return openAt(ws, spot.path, spot.row, spot.col, spot.col, { record: false })
}

export async function navigateBack(ws: Workspace): Promise<void> {
  const target = back.pop()
  if (!target) return ws.notify("Nothing to go back to")
  const spot = here(ws)
  if (spot) forward.push(spot)
  await goTo(ws, target)
}

export async function navigateForward(ws: Workspace): Promise<void> {
  const target = forward.pop()
  if (!target) return ws.notify("Nothing to go forward to")
  const spot = here(ws)
  if (spot) back.push(spot)
  await goTo(ws, target)
}

/** For tests. */
export function resetNavHistory(): void {
  back.length = 0
  forward.length = 0
}
