import type { Modal } from "./state"
import type { Workspace } from "./workspace"

/** How many dialogs deep `back` goes; older ones are dropped. */
const DEPTH = 5

/** Open `modal` over the dialog showing: closing it (Escape, a click outside, Cancel) returns there. */
export function openOver(ws: Workspace, modal: Modal): void {
  const under = ws.ui.get().modal
  ws.ui.set({ modal: under ? { ...modal, back: trim(under, DEPTH - 1) } : modal })
}

/** Close the dialog showing: back to the one it opened over, or none. */
export function closeModal(ws: Workspace): void {
  ws.ui.set({ modal: ws.ui.get().modal?.back ?? null })
}

function trim(m: Modal, depth: number): Modal {
  if (!m.back) return m
  if (depth <= 1) {
    const { back: _, ...rest } = m
    return rest as Modal
  }
  return { ...m, back: trim(m.back, depth - 1) }
}

/** Whether the dialog changed since `before` (read before an `await`): a result must not replace one opened meanwhile. */
export function modalChanged(ws: Workspace, before: Modal | null): boolean {
  return ws.ui.get().modal !== before
}
