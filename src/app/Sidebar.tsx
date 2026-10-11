import type { ReactNode } from "react"
import { HoverBox } from "./Modal"
import { useUi, useWorkspace } from "./workspace"
import { ui as colors } from "../config/theme"

/**
 * The left pane: FILES (the tree) and SEARCH (find and replace in all files), as tabs. Both
 * stay mounted, so switching keeps the tree's scroll and the search results.
 */
export function Sidebar({ files, search }: { files: ReactNode; search: ReactNode }) {
  const ws = useWorkspace()
  const ui = useUi()
  const focused = ui.focus === "tree" && !ui.modal
  // Nerd Fonts: a home icon for the tree and a magnifier for search; plain labels otherwise.
  const nerd = ws.config.tree.icons === "nerd"
  const tab = (id: "files" | "search", label: string) => {
    const on = ui.sidebar === id
    return (
      <HoverBox onPress={() => ws.ui.set({ sidebar: id, focus: "tree" })} paddingX={1}>
        <text selectable={false} fg={on ? (focused ? colors.accent : colors.text) : colors.dim}>
          {on ? <strong>{label}</strong> : label}
        </text>
      </HoverBox>
    )
  }
  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={colors.panelBg} overflow="hidden">
      <box height={1} flexShrink={0} flexDirection="row" backgroundColor={colors.headerBg} overflow="hidden">
        {tab("files", nerd ? "\u{f02dc}" : "FILES")}
        {tab("search", nerd ? "\u{f0349}" : "SEARCH")}
      </box>
      <box flexGrow={1} flexDirection="column" visible={ui.sidebar === "files"}>
        {files}
      </box>
      <box flexGrow={1} flexDirection="column" visible={ui.sidebar === "search"} paddingLeft={1}>
        {search}
      </box>
    </box>
  )
}
