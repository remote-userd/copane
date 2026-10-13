import { useEffect } from "react"
import { useCursor, useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import type { CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import { inlineBlameText, useLineBlameAt } from "./blame"

/** The cursor line's blame after its end, as in GitLens (`git.inlineBlame`). Draws nothing itself: the editor does. */
export function InlineBlame() {
  const ws = useWorkspace()
  useCursor() // follow the cursor to other lines
  const at = useLineBlameAt(ws, ws.config.git.inlineBlame)
  const buf = ws.buffers.active
  const ed = buf?.kind === "text" ? (buf.textarea as CodeEditorRenderable | null | undefined) : null
  const text = at && at.bufId === buf?.id ? inlineBlameText(at.line) : null
  useEffect(() => {
    if (!ed || ed.isDestroyed) return
    ed.setLineNote(text && at ? { row: at.row, text, fg: colors.inlineBlame } : null)
  }, [ed, text, at?.row])
  // A tab left behind keeps no note.
  useEffect(() => () => void (ed && !ed.isDestroyed && ed.setLineNote(null)), [ed])
  return null
}
