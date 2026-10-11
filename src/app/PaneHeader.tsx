import type { ReactNode } from "react"
import { ui as colors } from "../config/theme"

/**
 * One-row header on top of a pane: a title (accent-coloured while the pane has focus) and
 * optional content on the right. Replaces the old boxed borders.
 */
export function PaneHeader({ title, focused, children, bg = colors.headerBg }: { title: string; focused: boolean; children?: ReactNode; bg?: string }) {
  return (
    <box height={1} flexShrink={0} flexDirection="row" backgroundColor={bg} paddingLeft={1} paddingRight={1} gap={1} overflow="hidden">
      <box flexShrink={0}>
        <text selectable={false} fg={focused ? colors.accent : colors.headerFg}>
          {focused ? <strong>{title}</strong> : title}
        </text>
      </box>
      {/* The title always shows in full; the extra content gives way when the pane is narrow. */}
      <box flexGrow={1} flexShrink={1} flexDirection="row" justifyContent="flex-end" overflow="hidden">
        {children}
      </box>
    </box>
  )
}
