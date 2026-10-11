import { useEffect, useRef, useState } from "react"
import type { Workspace } from "../app/workspace"
import { lineAt } from "../editor/CodeEditorRenderable"
import { NOT_COMMITTED, type BlameLine } from "./repo"

/** "3 days ago" from a unix time. */
export function ago(time: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - time)
  const units: [number, string][] = [
    [31_536_000, "year"],
    [2_592_000, "month"],
    [604_800, "week"],
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ]
  for (const [secs, name] of units) {
    const n = Math.floor(s / secs)
    if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`
  }
  return "just now"
}

export function describeBlame(b: BlameLine | undefined): string | null {
  if (!b) return null
  if (b.sha === NOT_COMMITTED) return "Not committed yet"
  return `${b.author} · ${ago(b.time)} · ${b.summary}`
}

/** One blame per file and text: recomputed only when the buffer's text changes. */
const cache = new Map<string, { key: string; lines: Promise<BlameLine[]> }>()

/** Drop blames of files that are no longer open. */
export function keepBlames(open: ReadonlySet<string>): void {
  for (const path of cache.keys()) if (!open.has(path)) cache.delete(path)
}

export function blameFor(ws: Workspace, path: string, text: string, textKey: string): Promise<BlameLine[]> {
  const repo = ws.git?.repo
  if (!repo) return Promise.resolve([])
  const key = `${textKey}:${ws.git!.getSnapshot()}`
  const hit = cache.get(path)
  if (hit?.key === key) return hit.lines
  const lines = repo.blame(path, text)
  cache.set(path, { key, lines })
  return lines
}

/**
 * Blame of the active buffer's cursor line, refreshed when the cursor settles on another line or
 * git's status changes. Typing doesn't re-run git blame (it sends the whole file each time); an
 * edited line shows as not committed right away instead.
 */
export function useLineBlame(ws: Workspace): BlameLine | undefined {
  const [line, setLine] = useState<BlameLine | undefined>(undefined)
  const buf = ws.buffers.active
  const row = buf?.cursor.row ?? -1
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blamed = useRef<{ id: number; row: number; text: string } | null>(null)
  const enabled = ws.config.git.blame && !!ws.git?.repo && !!buf
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!enabled || !buf) return setLine(undefined)
    let live = true
    timer.current = setTimeout(async () => {
      const text = ws.buffers.textOf(buf)
      const lines = await blameFor(ws, buf.path, text, buf.lastTextHash)
      if (!live) return
      blamed.current = { id: buf.id, row, text: text.split("\n", row + 1)[row] ?? "" }
      setLine(lines[row])
    }, 300)
    return () => {
      live = false
      if (timer.current) clearTimeout(timer.current)
    }
    // lastTextHash is left out on purpose: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, buf?.id, buf?.path, row, enabled ? ws.git!.getSnapshot() : 0])
  useEffect(() => {
    const b = blamed.current
    const ta = buf?.textarea
    if (!enabled || !buf || !ta || b?.id !== buf.id || b.row !== row || line?.sha === NOT_COMMITTED) return
    if (lineAt(ta, row) !== b.text) setLine(UNCOMMITTED)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buf?.lastTextHash])
  return line
}

const UNCOMMITTED: BlameLine = { sha: NOT_COMMITTED, author: "", time: 0, summary: "" }
