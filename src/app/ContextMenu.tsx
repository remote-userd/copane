import { useState } from "react"
import { safely } from "./safely"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { Modal as ModalState } from "./state"
import { useWorkspace } from "./workspace"
import { ui as colors } from "../config/theme"

type Menu = Extract<ModalState, { kind: "menu" }>

export function ContextMenu({ menu }: { menu: Menu }) {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const enabled = menu.items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0)
  const [sel, setSel] = useState(enabled[0] ?? 0)

  // Dismissed: back to the dialog it opened over, if any. A chosen item decides where it goes.
  const close = () => ws.ui.set({ modal: menu.over ?? null })
  const choose = (i: number) => {
    const item = menu.items[i]
    if (!item || item.disabled) return
    ws.ui.set({ modal: null })
    void safely(ws, item.run)
  }
  const step = (d: number) => {
    if (!enabled.length) return
    const pos = enabled.indexOf(sel)
    setSel(enabled[(pos + d + enabled.length) % enabled.length]!)
  }

  useKeyboard((key) => {
    key.preventDefault()
    key.stopPropagation()
    if (key.name === "escape") close()
    else if (key.name === "up") step(-1)
    else if (key.name === "down" || key.name === "tab") step(1)
    else if (key.name === "return" || key.name === "space") choose(sel)
  })

  const labelW = Math.max(...menu.items.map((i) => i.label.length))
  const hintW = Math.max(0, ...menu.items.map((i) => i.hint?.length ?? 0))
  const width = labelW + hintW + 6
  const height = menu.items.length + 2
  // Open at the pointer, flipped to stay on screen.
  const left = menu.x + width > dims.width ? Math.max(0, menu.x - width + 1) : menu.x
  const top = menu.y + height > dims.height ? Math.max(0, menu.y - height + 1) : menu.y

  return (
    <>
      <box
        position="absolute"
        left={0}
        top={0}
        width={dims.width}
        height={dims.height}
        zIndex={199}
        onMouseDown={(e) => {
          // preventDefault keeps the editor's text selection: the renderer clears it on unhandled clicks.
          e.preventDefault()
          e.stopPropagation()
          close()
        }}
      />
      <box
        position="absolute"
        left={left}
        top={top}
        width={width}
        height={height}
        zIndex={200}
        border
        borderStyle="single"
        borderColor={colors.border}
        backgroundColor={colors.panelBg}
        flexDirection="column"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        {menu.items.map((item, i) => (
          <box
            key={item.label}
            flexDirection="row"
            height={1}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={i === sel && !item.disabled ? colors.selectionBg : undefined}
            onMouseOver={() => !item.disabled && setSel(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              choose(i)
            }}
          >
            {/* Not selectable: pressing a label must not start a new text selection that replaces the editor's. */}
            <text fg={item.disabled ? colors.dim : colors.text} flexGrow={1} selectable={false}>
              {item.label}
            </text>
            {item.hint ? (
              <text fg={colors.dim} selectable={false}>
                {item.hint}
              </text>
            ) : null}
          </box>
        ))}
      </box>
    </>
  )
}
