// readFileSync: renderNode is synchronous and needs an image's size to lay it out; Bun has no sync read.
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { useEffect, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import { BoxRenderable, ImageRenderable, imageInfo, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import type { MarkdownOptions } from "@opentui/core"
import { useBuffers, useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { getSyntaxStyle } from "../editor/syntaxStyle"
import type { ImageRenderProtocol } from "@opentui/core"

/** Images taller than this many rows are scaled down. */
const MAX_IMAGE_ROWS = 20

type Token = Parameters<NonNullable<MarkdownOptions["renderNode"]>>[0]

/** A local image's path, or null for remote URLs (never fetched) and data URIs. */
export function localImagePath(href: string, mdPath: string): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null
  const clean = decodeURI(href.split(/[?#]/)[0]!)
  return resolve(dirname(mdPath), clean)
}

/**
 * Cells for an image `w`×`h` pixels within `cols`×`rows`: shrunk to fit, never enlarged past its
 * own size (taking a cell as 8×16 pixels), keeping the aspect ratio (cells are twice as tall as wide).
 */
export function imageCells(w: number, h: number, cols: number, rows: number): { width: number; height: number } {
  let width = Math.max(1, Math.min(cols, Math.ceil(w / 8)))
  let height = Math.max(1, Math.round((width * h) / w / 2))
  if (height > rows) {
    height = Math.max(1, rows)
    width = Math.max(1, Math.min(width, Math.round((height * 2 * w) / h)))
  }
  return { width, height }
}

/**
 * Renders a paragraph made only of local images as the pictures themselves. Anything else
 * (text around them, remote or missing images) keeps the default rendering: the alt text as a link.
 */
function imageRenderer(mdPath: string, cols: () => number, protocol: ImageRenderProtocol): MarkdownOptions["renderNode"] {
  return (token: Token, context) => {
    if (token.type !== "paragraph" || !("tokens" in token) || !token.tokens) return null
    const parts = token.tokens.filter((t) => !(t.type === "text" && !t.raw.trim()) && t.type !== "br")
    if (!parts.length || parts.some((t) => t.type !== "image")) return null
    const images: { path: string; width: number; height: number }[] = []
    for (const t of parts) {
      const path = localImagePath((t as { href: string }).href, mdPath)
      if (!path) return null
      try {
        const info = imageInfo(readFileSync(path))
        images.push({ path, ...imageCells(info.width, info.height, cols(), MAX_IMAGE_ROWS) })
      } catch {
        return null // missing or not an image
      }
    }
    // renderNode gets no render context; borrow the one the default renderable was made with.
    const fallback = context.defaultRender()
    if (!fallback) return null
    const ctx = fallback.ctx
    fallback.destroy()
    const box = new BoxRenderable(ctx, { flexDirection: "column", gap: 1 })
    for (const img of images) {
      box.add(new ImageRenderable(ctx, { source: img.path, fit: "fit", protocol, width: img.width, height: img.height }))
    }
    return box as Renderable
  }
}

/** Arrow keys, PgUp/PgDn, Space, Home/End scroll the preview (mounted only while it has focus). */
function ScrollKeys({ scroll }: { scroll: React.RefObject<ScrollBoxRenderable | null> }) {
  useKeyboard((key) => {
    const box = scroll.current
    if (!box) return
    const page = Math.max(1, box.height - 2)
    const by: Record<string, number> = { up: -1, down: 1, pageup: -page, pagedown: page, space: page }
    if (key.name in by) box.scrollBy(by[key.name]!)
    else if (key.name === "home") box.scrollTop = 0
    else if (key.name === "end") box.scrollTop = box.scrollHeight
    else return
    key.preventDefault()
  })
  return null
}

/**
 * The rendered view of a Markdown file. Follows the open tab's text as you type (and when the AI
 * edits it), or the file on disk when it isn't open.
 */
export function MarkdownPreview({ path, active, focused, version = 0 }: { path: string; active: boolean; focused: boolean; version?: number }) {
  const ws = useWorkspace()
  useBuffers() // re-render when the file is opened or closed as a tab
  const scroll = useRef<ScrollBoxRenderable | null>(null)
  const width = useRef(80)
  const source = ws.buffers.byPath(path)
  const live = source?.kind === "text" ? source : null
  const [text, setText] = useState(() => (live ? ws.buffers.textOf(live) : ""))

  // The open tab: follow its text, debounced so typing stays fast.
  useEffect(() => {
    if (!live) return
    setText(ws.buffers.textOf(live))
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = ws.buffers.onText((id) => {
      if (id !== live.id) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setText(ws.buffers.textOf(live)), 150)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [ws, live])

  // Not open: read the file, again whenever it changes on disk (version).
  useEffect(() => {
    if (live) return
    let stale = false
    void Bun.file(path)
      .text()
      .then((t) => !stale && setText(t))
      .catch(() => !stale && setText(`*${path} could not be read.*`))
    return () => {
      stale = true
    }
  }, [path, live, version])

  const protocol = ws.config.preview.imageProtocol
  // Made once per preview (previews are keyed by file), so typing doesn't rebuild the images.
  const [renderNode] = useState(() => imageRenderer(path, () => width.current, protocol))

  return (
    <scrollbox
      ref={scroll}
      visible={active}
      flexGrow={1}
      flexBasis={0}
      backgroundColor={colors.bg}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      onSizeChange={function (this: ScrollBoxRenderable) {
        width.current = Math.max(10, this.width - 6)
      }}
      onMouseDown={() => {
        if (ws.ui.get().focus !== "editor") ws.ui.set({ focus: "editor" })
      }}
    >
      {focused ? <ScrollKeys scroll={scroll} /> : null}
      <markdown content={text} syntaxStyle={getSyntaxStyle()} conceal fg={colors.text} renderNode={renderNode} />
    </scrollbox>
  )
}
