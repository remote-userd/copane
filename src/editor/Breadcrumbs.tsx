import { useEffect, useRef, useState } from "react"
import { sep } from "node:path"
import type { BoxRenderable } from "@opentui/core"
import { useBuffers, useCursor, useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { colToIndex } from "../lsp/positions"
import { lineAt } from "./CodeEditorRenderable"

/**
 * `src › editor › EditorPane.tsx › BufferView › onContent` under the tabs: where the active
 * file is, and (with a language server) which symbol the cursor is in. Click a folder to
 * reveal it in the tree.
 */
export function Breadcrumbs({ reveal }: { reveal?: (path: string) => void }) {
  const ws = useWorkspace()
  const buffers = useBuffers()
  useCursor() // the symbol path follows the cursor
  const buf = buffers.active
  const [symbols, setSymbols] = useState<string[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  const boxRef = useRef<BoxRenderable | null>(null)
  const [width, setWidth] = useState(0)

  // Re-ask for the symbol path when the cursor settles (and when the text changes).
  const row = buf?.cursor.row ?? 0
  const col = buf?.cursor.col ?? 0
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!buf || !ws.lsp?.hasServer(buf.path)) return setSymbols([])
    const mine = ++seq.current
    timer.current = setTimeout(async () => {
      const ta = buf.textarea
      const line = ta ? lineAt(ta, row) : ""
      const path = await ws.lsp!.symbolPath(buf.path, { line: row, character: colToIndex(line, col) })
      // "useCallback() callback" → "useCallback()": anonymous functions named by their call.
      if (mine === seq.current) setSymbols(path.map((n) => n.replace(/ callback$/, "")).slice(-2))
    }, 250)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [ws, buf, row, col, buf?.version])

  if (!buf) return null
  const parts = buf.relPath.split(sep)
  const file = buf.kind === "preview" ? buf.name : parts.at(-1)!
  let dirs = parts.slice(0, -1)
  // Drop leading folders (shown as "…") until the row fits; the file and symbols matter most.
  const ARROW = 3
  const used = Bun.stringWidth(file) + symbols.reduce((n, s) => n + ARROW + Bun.stringWidth(s), 0) + 2
  const dirsWidth = (d: string[]) => d.reduce((n, x) => n + Bun.stringWidth(x) + ARROW, 0)
  let skipped = 0
  while (width > 0 && dirs.length && used + dirsWidth(dirs) + (skipped ? 1 + ARROW : 0) > width) {
    dirs = dirs.slice(1)
    skipped++
  }
  const dirPath = (i: number) => [ws.root, ...parts.slice(0, skipped + i + 1)].join(sep)
  const arrow = (k: string) => (
    <text key={k} selectable={false} fg={colors.divider} flexShrink={0}>
      {" › "}
    </text>
  )
  return (
    <box
      ref={boxRef}
      onSizeChange={() => boxRef.current && setWidth(boxRef.current.width)}
      height={1}
      flexShrink={0}
      flexDirection="row"
      paddingLeft={1}
      overflow="hidden"
      backgroundColor={colors.bg}
    >
      {skipped ? [<text key="more" selectable={false} fg={colors.headerFg} flexShrink={0}>…</text>, arrow("am")] : null}
      {dirs.flatMap((d, i) => [
        <box
          key={`d${i}`}
          flexShrink={0}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            reveal?.(dirPath(i))
          }}
        >
          <text selectable={false} fg={colors.headerFg}>
            {d}
          </text>
        </box>,
        arrow(`a${i}`),
      ])}
      <text selectable={false} fg={colors.text} flexShrink={0}>
        {file}
      </text>
      {symbols.flatMap((s, i) => [
        arrow(`s${i}`),
        <text key={`n${i}`} selectable={false} fg={i === symbols.length - 1 ? colors.accent : colors.headerFg} flexShrink={0}>
          {s}
        </text>,
      ])}
    </box>
  )
}
