import { SyntaxStyle } from "@opentui/core"
import { syntaxTheme } from "../config/theme"
import { onShutdown } from "../app/shutdown"

let style: SyntaxStyle | null = null

/** Lazily created after the renderer exists (it allocates native memory). Destroyed on shutdown. */
export function getSyntaxStyle(): SyntaxStyle {
  if (!style) {
    style = SyntaxStyle.fromStyles(syntaxTheme)
    onShutdown(() => {
      style?.destroy()
      style = null
    })
  }
  return style
}
