import type { Workspace } from "./workspace"

/**
 * Run a UI action (a menu item, a dialog button) and show a failure as a notice. An action
 * that throws must never take the editor down: the user's other files are still unsaved.
 */
export async function safely(ws: Workspace, action: () => unknown): Promise<void> {
  try {
    await action()
  } catch (err) {
    ws.notify(err instanceof Error ? err.message : String(err), "error")
  }
}
