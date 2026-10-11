import { useEffect, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useBuffers, useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { MarkdownView } from "./MarkdownView"

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
  const [width, setWidth] = useState(80)
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
        // Less the padding and the scrollbar.
        const w = Math.max(10, this.width - 5)
        setWidth((old) => (old === w ? old : w))
      }}
      onMouseDown={() => {
        if (ws.ui.get().focus !== "editor") ws.ui.set({ focus: "editor" })
      }}
    >
      {focused ? <ScrollKeys scroll={scroll} /> : null}
      <MarkdownView text={text} ctx={{ path, width, protocol: ws.config.preview.imageProtocol }} />
    </scrollbox>
  )
}
