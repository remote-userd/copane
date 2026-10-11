import { useState, type ReactNode } from "react"
import { useTerminalDimensions } from "@opentui/react"
import { ui as colors } from "../config/theme"

export interface ModalProps {
  title: string
  width?: number
  height?: number
  /** Clicking outside the dialog calls this. */
  onClose?: () => void
  children: ReactNode
}

export function Modal({ title, width = 60, height, onClose, children }: ModalProps) {
  const dims = useTerminalDimensions()
  const w = Math.min(width, dims.width - 4)
  const h = height ? Math.min(height, dims.height - 2) : undefined
  return (
    <>
      {/* Invisible full-screen backdrop: swallows clicks behind the dialog and closes it. */}
      <box
        position="absolute"
        left={0}
        top={0}
        width={dims.width}
        height={dims.height}
        zIndex={99}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClose?.()
        }}
        onMouseScroll={(e) => e.stopPropagation()}
      />
      <box
        position="absolute"
        left={Math.max(0, Math.floor((dims.width - w) / 2))}
        top={Math.max(0, Math.floor((dims.height - (h ?? 10)) / 3))}
        width={w}
        height={h}
        zIndex={100}
        border
        borderStyle="rounded"
        borderColor={colors.borderFocused}
        backgroundColor={colors.panelBg}
        title={` ${title} `}
        flexDirection="column"
        padding={1}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        {children}
      </box>
    </>
  )
}

export function HoverBox({
  children,
  onPress,
  bg,
  hoverBg = colors.selectionBg,
  paddingX = 0,
  flexGrow,
}: {
  children: ReactNode
  onPress?: (button: number) => void
  bg?: string
  hoverBg?: string
  paddingX?: number
  flexGrow?: number
}) {
  const [hover, setHover] = useState(false)
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      flexGrow={flexGrow}
      paddingLeft={paddingX}
      paddingRight={paddingX}
      backgroundColor={hover ? hoverBg : bg}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={(e) => {
        if (!onPress) return
        // preventDefault: an unhandled click would clear the editor's text selection.
        e.preventDefault()
        e.stopPropagation()
        onPress(e.button)
      }}
    >
      {children}
    </box>
  )
}
