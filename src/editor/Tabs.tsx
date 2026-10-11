import { useRef, useState } from "react"
import type { BoxRenderable } from "@opentui/core"
import { useBuffers, useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { closeBuffer } from "../keymap/commands"
import type { Buffer } from "./BufferStore"
import { iconFor } from "../files/icons"
import { PaneHeader } from "../app/PaneHeader"

const MIDDLE = 1
const GAP = 1

/** Cells a tab takes: left padding, icon (2 when shown), name, space, close box. */
const tabWidth = (b: Pick<Buffer, "name">, icon = 0) => 1 + icon + Bun.stringWidth(b.name) + 1 + 2

/**
 * First tab to draw so the active one is visible. Moves only as far as needed from `prev`,
 * so cycling through tabs doesn't make the strip jump around.
 */
export function firstVisibleTab(widths: number[], active: number, width: number, prev: number): number {
  if (active < 0) return 0
  let first = Math.min(Math.max(0, prev), active)
  const span = (a: number, b: number) => widths.slice(a, b + 1).reduce((n, w) => n + w, 0) + (b - a) * GAP
  while (first < active && span(first, active) > width) first++
  // Use free room on the right to bring earlier tabs back.
  while (first > 0 && span(first - 1, widths.length - 1) <= width) first--
  return first
}

function Tab({ buf, active, paneFocused }: { buf: Buffer; active: boolean; paneFocused: boolean }) {
  const ws = useWorkspace()
  const [hover, setHover] = useState(false)
  const [hoverClose, setHoverClose] = useState(false)
  const mark = buf.conflict ? "!" : buf.deleted ? "✗" : buf.dirty ? "●" : null
  const icon = iconFor(buf.name, false, false, ws.config.tree.icons)
  // VS Code style: the dirty dot turns into × on hover; clean tabs show × when active or hovered.
  const showClose = hover || active || !mark
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      paddingLeft={1}
      backgroundColor={active ? colors.bg : hover ? colors.selectionBg : colors.headerBg}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.button === MIDDLE) closeBuffer(ws, buf.id)
        else {
          ws.buffers.activate(buf.id)
          ws.ui.set({ focus: "editor" })
        }
      }}
    >
      {icon ? (
        <text selectable={false} fg={icon.color}>
          {icon.glyph}{" "}
        </text>
      ) : null}
      <text selectable={false} fg={active ? (paneFocused ? colors.accent : colors.text) : colors.dim}>
        {active && paneFocused ? <strong>{buf.name}</strong> : buf.name}{" "}
      </text>
      <box
        width={2}
        onMouseOver={() => setHoverClose(true)}
        onMouseOut={() => setHoverClose(false)}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          closeBuffer(ws, buf.id)
        }}
      >
        <text selectable={false} fg={hoverClose ? colors.error : mark && !hover ? colors.warn : colors.dim}>
          {mark && !hover ? mark : showClose ? "×" : " "}
        </text>
      </box>
    </box>
  )
}

export function Tabs({ focused = false }: { focused?: boolean }) {
  const ws = useWorkspace()
  const buffers = useBuffers()
  const ref = useRef<BoxRenderable | null>(null)
  const [width, setWidth] = useState(0)
  const first = useRef(0)
  const list = buffers.list()
  if (list.length === 0) return <PaneHeader title="EDITOR" focused={focused} />
  const activeId = buffers.active?.id
  const activeIdx = list.findIndex((b) => b.id === activeId)
  const iconW = ws.config.tree.icons === "none" ? 0 : 2
  first.current = width > 0 ? firstVisibleTab(list.map((b) => tabWidth(b, iconW)), activeIdx, width, first.current) : 0
  return (
    <box
      ref={ref}
      onSizeChange={() => ref.current && setWidth(ref.current.width)}
      flexDirection="row"
      height={1}
      flexShrink={0}
      overflow="hidden"
      backgroundColor={colors.headerBg}
      onMouseScroll={(e) => {
        e.stopPropagation()
        const d = e.scroll?.direction
        buffers.cycle(d === "up" || d === "left" ? -1 : 1)
      }}
    >
      {list.slice(first.current).flatMap((b, i) => [
        ...(i > 0
          ? [
              <box key={`sep${b.id}`} width={GAP} flexShrink={0}>
                <text selectable={false} fg={colors.divider}>
                  │
                </text>
              </box>,
            ]
          : []),
        <Tab key={b.id} buf={b} active={b.id === activeId} paneFocused={focused} />,
      ])}
    </box>
  )
}
