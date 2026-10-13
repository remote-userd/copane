import { useEffect, useState } from "react"
import { Renderable, RGBA, type OptimizedBuffer } from "@opentui/core"
import { extend } from "@opentui/react"
import { useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { clipCols, type CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import type { Buffer } from "../editor/BufferStore"
import { blameFor, shortAgo } from "./blame"
import { NOT_COMMITTED, type BlameLine } from "./repo"

const rgb = (hex: string) => RGBA.fromHex(hex)
const BG = rgb(colors.blameColumnBg)
const CURRENT_BG = rgb(colors.segmentBg)
const AUTHOR = rgb(colors.blameAuthor)
const TEXT = rgb(colors.text)
const DIM = rgb(colors.dim)
const FAINT = rgb(colors.gutterFg)

/**
 * GitLens' file blame: beside the editor, who last changed each block of lines, when, and why.
 * The label sits on the first screen row of each block; the cursor's commit is shaded throughout.
 * Reads the editor's scroll position every frame, so it follows scrolling and word wrap.
 */
export class BlameColumnRenderable extends Renderable {
  editor: CodeEditorRenderable | null = null
  lines: BlameLine[] = []

  /** The source line drawn at screen row `y` (absolute), or -1. */
  lineAtY(y: number): number {
    const ed = this.editor
    if (!ed || ed.isDestroyed) return -1
    return ed.screenLineSources()[y - this.y] ?? -1
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    buffer.fillRect(this.x, this.y, this.width, this.height, BG)
    const ed = this.editor
    if (!ed || ed.isDestroyed || !this.lines.length) return
    const sources = ed.screenLineSources()
    const cursorSha = this.lines[ed.logicalCursor.row]?.sha
    const room = this.width - 1 // one blank column before the line numbers
    for (let i = 0; i < sources.length && i < this.height; i++) {
      const src = sources[i]!
      const b = this.lines[src]
      if (!b) continue
      const y = this.y + i
      const current = b.sha === cursorSha && b.sha !== NOT_COMMITTED
      if (current) buffer.fillRect(this.x, y, room, 1, CURRENT_BG)
      const bg = current ? CURRENT_BG : BG
      // A label on a block's first line, and on the top row so a block cut by scrolling still says whose it is.
      const first = i === 0 || (sources[i - 1] !== src && this.lines[src - 1]?.sha !== b.sha)
      if (!first) continue
      if (b.sha === NOT_COMMITTED) {
        buffer.drawText(clipCols(" Not committed", room), this.x, y, FAINT, bg)
        continue
      }
      const authorW = Math.min(14, Math.max(6, Math.floor(room * 0.35)))
      const author = clipCols(b.author, authorW - 1).padEnd(authorW)
      const age = shortAgo(b.time).padStart(3) + " "
      let x = this.x + 1
      buffer.drawText(clipCols(author, room - 1), x, y, current ? TEXT : AUTHOR, bg)
      x += authorW
      if (x + age.length >= this.x + room) continue
      buffer.drawText(age, x, y, DIM, bg)
      x += age.length + 1
      const left = this.x + room - x
      if (left > 2) buffer.drawText(clipCols(b.summary, left), x, y, current ? TEXT : DIM, bg)
    }
  }
}

extend({ "blame-column": BlameColumnRenderable })

declare module "@opentui/react" {
  interface OpenTUIComponents {
    "blame-column": typeof BlameColumnRenderable
  }
}

/** File blame beside a text buffer (Alt+B). A click on a block opens its commit. */
export function BlameColumn({ buf, width }: { buf: Buffer; width: number }) {
  const ws = useWorkspace()
  const [col, setCol] = useState<BlameColumnRenderable | null>(null)
  const [lines, setLines] = useState<BlameLine[]>([])
  const contents = ws.git?.contentsVersion ?? 0

  // Blame again after edits settle (it sends the whole text to git) and when HEAD or the index change.
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      void blameFor(ws, buf.path, ws.buffers.textOf(buf), `${buf.id}:${buf.version}`)
        .then((l) => live && setLines(l))
        .catch(() => {})
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [ws, buf, buf.path, buf.version, contents])

  useEffect(() => {
    if (!col) return
    col.editor = (buf.textarea as CodeEditorRenderable | null) ?? null
    col.lines = lines
    col.requestRender()
  }, [col, buf, buf.textarea, lines])

  return (
    <blame-column
      ref={setCol}
      width={width}
      flexShrink={0}
      onMouseDown={(e) => {
        if (!col || e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        const b = lines[col.lineAtY(e.y)]
        if (b && b.sha !== NOT_COMMITTED) ws.ui.set({ modal: { kind: "history", path: buf.path, sha: b.sha } })
      }}
    />
  )
}
