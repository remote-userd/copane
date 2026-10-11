import { useEffect, useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { HoverBox } from "../app/Modal"
import { useUi, useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import type { CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import { gotoChange, hunkContext, revertHunkAt, stageHunk, type HunkContext } from "./hunkActions"

const MAX_LINES = 12

/**
 * Inline view of one change under its lines: what was removed (red) and added (green),
 * with Stage / Revert / Prev / Next. Keys: s, r, ↑, ↓, Esc. Other keys close it.
 */
export function HunkPeek() {
  const ws = useWorkspace()
  const ui = useUi()
  const dims = useTerminalDimensions()
  const peek = ui.hunkPeek
  const [ctx, setCtx] = useState<HunkContext | null>(null)
  const close = () => ws.ui.set({ hunkPeek: null })

  useEffect(() => {
    let live = true
    if (!peek) return setCtx(null)
    void hunkContext(ws, peek.row).then((c) => {
      if (!live) return
      if (!c) {
        ws.ui.set({ hunkPeek: null })
        ws.notify("No change on this line")
      } else setCtx(c)
    })
    return () => {
      live = false
    }
  }, [ws, peek?.bufId, peek?.row])

  // Close when the buffer changes, focus moves, or a dialog opens.
  useEffect(() => {
    if (peek && (ws.buffers.active?.id !== peek.bufId || ui.focus !== "editor" || ui.modal)) close()
  })

  const stage = async () => {
    if (!peek) return
    const err = await stageHunk(ws, peek.row)
    ws.notify(err ?? "Staged this change", err ? "error" : "info")
    close()
  }
  const revert = async () => {
    if (!peek) return
    const err = await revertHunkAt(ws, peek.row)
    ws.notify(err ?? "Reverted this change (Ctrl+Z undoes)", err ? "error" : "info")
    close()
  }
  const step = async (dir: 1 | -1) => {
    const row = await gotoChange(ws, dir)
    if (row !== null) ws.ui.set({ hunkPeek: { bufId: ws.buffers.active!.id, row } })
  }

  useKeyboard((key) => {
    if (!peek || ui.modal) return
    const handled = ["s", "r", "up", "down", "escape"].includes(key.name) && !key.ctrl
    if (!handled) return close() // let the key reach the editor
    key.preventDefault()
    key.stopPropagation()
    if (key.name === "s") void stage()
    else if (key.name === "r") void revert()
    else if (key.name === "down") void step(1)
    else if (key.name === "up") void step(-1)
    else close()
  })

  const ed = ws.buffers.active?.textarea as CodeEditorRenderable | null | undefined
  if (!peek || !ctx || !ed) return null
  const h = ctx.hunk
  const lines = [...h.removed.map((t) => ({ t, add: false })), ...h.added.map((t) => ({ t, add: true }))]
  const shown = lines.slice(0, MAX_LINES)
  const lastRow = h.newStart + Math.max(1, h.newLines) - 1
  const anchor = ed.rowScreenY(Math.min(lastRow, ed.lineCount - 1)) ?? ed.y
  // Top and bottom border, the header row, the lines, and the "more" note.
  const height = shown.length + 3 + (lines.length > MAX_LINES ? 1 : 0)
  const below = anchor + 1 + height <= dims.height - 1
  const top = below ? anchor + 1 : Math.max(0, anchor - height - Math.max(0, h.newLines - 1))
  const idx = ctx.all.indexOf(h) + 1
  const btn = (label: string, run: () => void) => (
    <HoverBox onPress={run} paddingX={1} bg={colors.segmentBg}>
      <text selectable={false} fg={colors.text}>
        {label}
      </text>
    </HoverBox>
  )
  return (
    <box
      position="absolute"
      left={ed.x}
      top={top}
      width={ed.width}
      height={height}
      zIndex={130}
      backgroundColor={colors.panelBg}
      border={["top", "bottom"]}
      borderColor={colors.accent}
      flexDirection="column"
    >
      <box flexDirection="row" height={1} gap={1} paddingLeft={1}>
        <text selectable={false} fg={colors.headerFg}>
          Change {idx} of {ctx.all.length}
        </text>
        <box flexGrow={1} />
        {btn("s Stage", () => void stage())}
        {btn("r Revert", () => void revert())}
        {btn("↑", () => void step(-1))}
        {btn("↓", () => void step(1))}
        {btn("Esc", close)}
      </box>
      {shown.map((l, i) => (
        <box key={i} height={1} overflow="hidden" paddingLeft={1}>
          <text selectable={false} fg={l.add ? colors.gitAdd : colors.gitDel}>
            {(l.add ? "+ " : "- ") + l.t}
          </text>
        </box>
      ))}
      {lines.length > MAX_LINES ? (
        <text selectable={false} fg={colors.dim}>
          {` … ${lines.length - MAX_LINES} more lines`}
        </text>
      ) : null}
    </box>
  )
}
