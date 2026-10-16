import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useWorkspace } from "./workspace"
import { ui as colors } from "../config/theme"
import { closeModal } from "./modalStack"

/** Read-only text near the cursor (hover info, a diagnostic). Any key or click closes it. */
export function InfoPopup({ x, y, text }: { x: number; y: number; text: string }) {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const close = () => closeModal(ws)
  useKeyboard((key) => {
    key.preventDefault()
    key.stopPropagation()
    close()
  })
  const width = Math.min(80, dims.width - 4, Math.max(20, ...text.split("\n").map((l) => Bun.stringWidth(l) + 4)))
  // Rough wrapped height; the box clips anything beyond.
  const lines = text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(Bun.stringWidth(l) / (width - 4))), 0)
  const height = Math.min(dims.height - 4, lines + 2)
  const below = y + 1 + height <= dims.height - 1
  const top = below ? y + 1 : Math.max(0, y - height)
  const left = Math.max(0, Math.min(x, dims.width - width))
  return (
    <>
      <box
        position="absolute"
        left={0}
        top={0}
        width={dims.width}
        height={dims.height}
        zIndex={159}
        onMouseDown={(e) => {
          e.preventDefault()
          close()
        }}
      />
      <box
        position="absolute"
        left={left}
        top={top}
        width={width}
        height={height}
        zIndex={160}
        border
        borderStyle="rounded"
        borderColor={colors.border}
        backgroundColor={colors.panelBg}
        paddingLeft={1}
        paddingRight={1}
        overflow="hidden"
      >
        <text fg={colors.text}>{text}</text>
      </box>
    </>
  )
}
