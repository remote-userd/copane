import { useEffect, useRef, useState } from "react"
import { useTerminalDimensions, useKeyboard } from "@opentui/react"
import { useBuffers, useUi, useWorkspace, type Workspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { lineAt, type CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import type { SignatureInfo } from "./LspManager"
import { colToIndex } from "./positions"

const editorOf = (ws: Workspace) => (ws.buffers.active?.textarea ?? null) as CodeEditorRenderable | null

/** Whether the cursor sits inside an unclosed "(" on its line (rough, ignores strings). */
export function insideCall(line: string, index: number): boolean {
  let depth = 0
  for (let i = index - 1; i >= 0; i--) {
    const c = line[i]
    if (c === ")") depth++
    else if (c === "(") {
      if (depth === 0) return true
      depth--
    }
  }
  return false
}

/**
 * Parameter hints: while typing inside a call, show the function's signature above the
 * cursor with the current argument highlighted. Opens on "(" or ",", closes on ")" or Esc,
 * or when the cursor leaves the call (typing over an auto-closed ")" only moves the cursor).
 */
export function SignaturePopup() {
  const ws = useWorkspace()
  const ui = useUi()
  const dims = useTerminalDimensions()
  const [sig, setSig] = useState<SignatureInfo | null>(null)
  const seq = useRef(0)
  const cursor = useBuffers().active?.cursor

  const refresh = async (open: boolean) => {
    const ed = editorOf(ws)
    const buf = ws.buffers.active
    if (!ed || !buf || !ws.lsp?.hasServer(buf.path)) {
      seq.current++
      return setSig(null)
    }
    const { row, col } = ed.logicalCursor
    const line = lineAt(ed, row)
    const index = colToIndex(line, col)
    if (!insideCall(line, index)) {
      seq.current++ // drop any answer still on its way
      return setSig(null)
    }
    if (!open && !sig) return
    const mine = ++seq.current
    const info = await ws.lsp.signatureHelp(buf.path, { line: row, character: index })
    if (mine === seq.current) setSig(info)
  }

  // Subscribed once; refresh is read through a ref so it sees the current render's state.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(
    () =>
      ws.buffers.onText((id) => {
        if (id !== ws.buffers.active?.id || ws.ui.get().focus !== "editor" || !ws.config.editor.parameterHints) return
        // The text changes before the cursor moves past the new character: look a tick later.
        setTimeout(() => {
          const ed = editorOf(ws)
          if (!ed || ed.isDestroyed) return
          const { row, col } = ed.logicalCursor
          const line = lineAt(ed, row)
          const before = line[colToIndex(line, col) - 1]
          void refreshRef.current(before === "(" || before === ",")
        }, 0)
      }),
    [ws],
  )

  useEffect(() => {
    if (sig && (ui.focus !== "editor" || ui.modal)) setSig(null)
  })

  useEffect(() => {
    if (sig) void refresh(false)
  }, [cursor?.row, cursor?.col])

  useKeyboard((key) => {
    if (sig && key.name === "escape") {
      setSig(null)
      key.preventDefault()
      key.stopPropagation()
    }
  })

  if (!sig) return null
  const ed = editorOf(ws)
  const pos = ed?.cursorScreenPos()
  if (!pos) return null
  const docLine = sig.doc?.split("\n")[0] ?? ""
  const width = Math.min(dims.width - 2, Math.max(Bun.stringWidth(sig.label), Bun.stringWidth(docLine)) + 2)
  const height = docLine ? 2 : 1
  const above = pos.y - height >= 0
  const y = above ? pos.y - height : pos.y + 1
  const x = Math.max(0, Math.min(pos.x - 4, dims.width - width))
  const [a, b] = sig.active ?? [0, 0]
  return (
    <box position="absolute" left={x} top={y} width={width} height={height} zIndex={140} backgroundColor={colors.panelBg} flexDirection="column" paddingLeft={1}>
      <box height={1} overflow="hidden">
        <text selectable={false} fg={colors.text}>
          {sig.label.slice(0, a)}
          <span fg={colors.warn}>{sig.label.slice(a, b)}</span>
          {sig.label.slice(b)}
        </text>
      </box>
      {docLine ? (
        <box height={1} overflow="hidden">
          <text selectable={false} fg={colors.dim}>
            {docLine}
          </text>
        </box>
      ) : null}
    </box>
  )
}
