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

/** "now", "5m", "3h", "2d", "3w", "4mo", "2y": for the narrow file blame column. */
export function shortAgo(time: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - time)
  const units: [number, string][] = [
    [31_536_000, "y"],
    [2_592_000, "mo"],
    [604_800, "w"],
    [86_400, "d"],
    [3_600, "h"],
    [60, "m"],
  ]
  for (const [secs, name] of units) if (s >= secs) return `${Math.floor(s / secs)}${name}`
  return "now"
}

export function describeBlame(b: BlameLine | undefined): string | null {
  if (!b) return null
  if (b.sha === NOT_COMMITTED) return "Not committed yet"
  return `${b.author} · ${ago(b.time)} · ${b.summary}`
}

/** One blame per file and text: recomputed only when the buffer's text changes. */
const cache = new Map<string, { key: string; lines: Promise<BlameLine[]> }>()

/** The blame running per file: the next waits for it, so moving around after edits never stacks up git processes. */
const running = new Map<string, Promise<unknown>>()

/** Drop blames of files that are no longer open. */
export function keepBlames(open: ReadonlySet<string>): void {
  for (const path of cache.keys()) if (!open.has(path)) cache.delete(path)
}

export function blameFor(ws: Workspace, path: string, text: string, textKey: string): Promise<BlameLine[]> {
  const repo = ws.git?.repo
  if (!repo) return Promise.resolve([])
  // Blame only changes with the text or with HEAD/the index, not with every status change.
  const key = `${textKey}:${ws.git!.contentsVersion}`
  const hit = cache.get(path)
  if (hit?.key === key) return hit.lines
  // Wait for the blame already running; by then a newer request may have taken this one's place.
  const lines = (running.get(path) ?? Promise.resolve()).then(() => (cache.get(path)?.key === key ? repo.blame(path, text) : []))
  const done = lines.catch(() => {})
  running.set(path, done)
  void done.then(() => running.get(path) === done && running.delete(path))
  cache.set(path, { key, lines })
  return lines
}

/**
 * Blame of the active buffer's cursor line, refreshed when the cursor settles on another line or
 * git's status changes. Typing doesn't re-run git blame (it sends the whole file each time); an
 * edited line shows as not committed right away instead.
 */
export function useLineBlame(ws: Workspace, on = ws.config.git.blame): BlameLine | undefined {
  return useLineBlameAt(ws, on)?.line
}

/** The same, with the line it is for: the cursor may have moved on before the next blame arrives. */
export function useLineBlameAt(ws: Workspace, on: boolean): { bufId: number; row: number; line: BlameLine | undefined } | undefined {
  const [at, setAt] = useState<{ bufId: number; row: number; line: BlameLine | undefined } | undefined>(undefined)
  const buf = ws.buffers.active
  const row = buf?.cursor.row ?? -1
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blamed = useRef<{ id: number; row: number; text: string } | null>(null)
  const enabled = on && !!ws.git?.repo && buf?.kind === "text"
  const setLine = (line: BlameLine | undefined) => setAt(buf && line ? { bufId: buf.id, row, line } : undefined)
  const line = at?.line
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!enabled || !buf) return setLine(undefined)
    let live = true
    timer.current = setTimeout(async () => {
      const text = ws.buffers.textOf(buf)
      const lines = await blameFor(ws, buf.path, text, `${buf.id}:${buf.version}`)
      if (!live) return
      blamed.current = { id: buf.id, row, text: text.split("\n", row + 1)[row] ?? "" }
      setLine(lines[row])
    }, 300)
    return () => {
      live = false
      if (timer.current) clearTimeout(timer.current)
    }
    // buf.version is left out on purpose: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, buf?.id, buf?.path, row, enabled ? ws.git!.contentsVersion : 0])
  useEffect(() => {
    const b = blamed.current
    const ta = buf?.textarea
    if (!enabled || !buf || !ta || b?.id !== buf.id || b.row !== row || line?.sha === NOT_COMMITTED) return
    if (lineAt(ta, row) !== b.text) setLine(UNCOMMITTED)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buf?.version])
  return at
}

/** GitLens' inline blame: "Ann, 3 days ago • Fix totals". Lines not committed get none. */
export function inlineBlameText(b: BlameLine | undefined): string | null {
  if (!b || b.sha === NOT_COMMITTED) return null
  return `${b.author}, ${ago(b.time)} • ${b.summary}`
}

const UNCOMMITTED: BlameLine = { sha: NOT_COMMITTED, author: "", time: 0, summary: "" }
