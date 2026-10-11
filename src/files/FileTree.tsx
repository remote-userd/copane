import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useKeyboard } from "@opentui/react"
import { basename } from "node:path"
import { useUi, useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import type { TreeModel } from "./TreeModel"
import type { GitMark, GitStatus } from "./gitStatus"
import { deleteItem, newItem, openTreeMenu, renameItem, revealItem } from "./treeActions"
import { iconFor, type IconStyle } from "./icons"
import { PaneHeader } from "../app/PaneHeader"

const RIGHT = 2
const shorten = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s)
const noGit = { subscribe: () => () => {}, getSnapshot: () => 0 }

function markColor(mark: GitMark | null): string | null {
  if (mark === "M") return colors.warn
  if (mark === "A" || mark === "U" || mark === "R") return colors.ok
  if (mark === "D" || mark === "!") return colors.error
  return null
}

export function FileTree({
  tree,
  height,
  git,
  icons = "none",
  header = true,
}: {
  tree: TreeModel
  height: number
  git?: GitStatus
  icons?: IconStyle
  /** Off inside the left pane, whose tab strip names it instead. */
  header?: boolean
}) {
  const ws = useWorkspace()
  const ui = useUi()
  useSyncExternalStore(tree.subscribe, tree.getSnapshot)
  useSyncExternalStore(git?.subscribe ?? noGit.subscribe, git?.getSnapshot ?? noGit.getSnapshot)
  const focused = ui.focus === "tree" && ui.sidebar === "files" && !ui.modal

  useEffect(() => {
    void tree.load()
  }, [tree])

  // Breadcrumb clicks ask the tree to reveal a folder.
  useEffect(() => {
    const p = ui.revealPath
    if (!p) return
    ws.ui.set({ revealPath: null })
    void tree.reveal(p).then(() => tree.expand(p))
  }, [ui.revealPath, tree, ws])

  const rows = tree.rows()
  const selectedIdx = Math.max(0, rows.findIndex((r) => r.entry.path === tree.selected))
  // One row for the header.
  const viewH = Math.max(1, height - (header ? 1 : 0))
  const maxTop = Math.max(0, rows.length - viewH)
  // Scroll offset is independent of the selection so the wheel can browse freely.
  const [topState, setTop] = useState(0)
  const top = Math.min(topState, maxTop)
  const [hovered, setHovered] = useState<string | null>(null)

  /** Keep the keyboard selection on screen. */
  const reveal = (idx: number) => {
    if (idx < top) setTop(idx)
    else if (idx >= top + viewH) setTop(idx - viewH + 1)
  }
  // When something else selects a row (breadcrumbs, opening a file), scroll it into view.
  const lastSelected = useRef(tree.selected)
  useEffect(() => {
    if (tree.selected === lastSelected.current) return
    lastSelected.current = tree.selected
    if (selectedIdx < top || selectedIdx >= top + viewH) setTop(Math.max(0, selectedIdx - Math.floor(viewH / 3)))
  })

  const moveBy = (delta: number) => {
    const next = tree.move(delta)
    if (next) reveal(tree.rows().findIndex((r) => r.entry.path === next.entry.path))
  }

  const openRow = async (idx: number) => {
    const row = rows[idx]
    if (!row) return
    tree.select(row.entry.path)
    if (row.entry.isDir) {
      ws.ui.set({ focus: "tree" })
      return tree.toggle(row.entry.path)
    }
    try {
      await ws.buffers.open(row.entry.path)
      ws.ui.set({ focus: "editor" })
    } catch (err) {
      ws.notify((err as Error).message, "warn")
    }
  }

  useKeyboard((key) => {
    if (!focused) return
    const row = rows[selectedIdx]
    let handled = true
    // Shift+Alt+R, as in VS Code's explorer: show the selected row in the system file manager.
    if (key.meta && key.shift && key.name.toLowerCase() === "r" && !key.ctrl) {
      key.preventDefault()
      void revealItem(ws, row?.entry.path ?? ws.root, row ? row.entry.isDir : true)
      return
    }
    if (key.ctrl || key.meta) return
    switch (key.name) {
      case "a":
        void newItem(ws, tree, row ?? null, key.shift ? "folder" : "file")
        break
      case "r":
      case "f2":
        if (row) renameItem(ws, tree, row)
        break
      case "delete":
        if (row) void deleteItem(ws, tree, row)
        break
      case "up":
        moveBy(-1)
        break
      case "down":
        moveBy(1)
        break
      case "pageup":
        moveBy(-viewH)
        break
      case "pagedown":
        moveBy(viewH)
        break
      case "return":
      case "space":
        void openRow(selectedIdx)
        break
      case "right":
        if (row?.entry.isDir && !row.expanded) void tree.toggle(row.entry.path)
        else moveBy(1)
        break
      case "left":
        if (row?.entry.isDir && row.expanded) tree.collapse(row.entry.path)
        else if (row && row.depth > 0) {
          const parent = rows.slice(0, selectedIdx).reverse().find((r) => r.depth === row.depth - 1)
          if (parent) {
            tree.select(parent.entry.path)
            reveal(rows.indexOf(parent))
          }
        }
        break
      case "escape":
        ws.ui.set({ focus: "editor" })
        break
      default:
        handled = false
    }
    if (handled) {
      key.preventDefault()
      key.stopPropagation()
    }
  })

  const visible = rows.slice(top, top + viewH)
  const activePath = ws.buffers.active?.path

  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={colors.panelBg}
      overflow="hidden"
      onMouseDown={(e) => {
        ws.ui.set({ focus: "tree", sidebar: "files" })
        // Right-click on empty space: create at the project root.
        if (e.button === RIGHT) openTreeMenu(ws, tree, null, e.x, e.y)
      }}
      onMouseScroll={(e) => {
        e.stopPropagation()
        const d = e.scroll?.direction === "up" ? -3 : e.scroll?.direction === "down" ? 3 : 0
        setTop(Math.max(0, Math.min(maxTop, top + d)))
      }}
    >
      {header ? (
        <PaneHeader title="EXPLORER" focused={focused} bg={colors.panelBg}>
          <text selectable={false} fg={colors.headerFg}>
            {shorten(basename(tree.root), 14)}
          </text>
        </PaneHeader>
      ) : null}
      {visible.map((r, i) => {
        const idx = top + i
        const isSel = idx === selectedIdx && tree.selected !== null
        const isHover = hovered === r.entry.path
        const icon = iconFor(r.entry.name, r.entry.isDir, r.expanded, icons)
        // A folder icon shows open/closed itself; the arrow is only for styles without one.
        const arrow = r.entry.isDir ? (icon ? "" : r.expanded ? "▾ " : "▸ ") : icons === "none" ? "  " : ""
        const isActive = r.entry.path === activePath
        const fg = isActive ? colors.accent : r.entry.isDir ? colors.text : colors.dim
        const mark = git ? (r.entry.isDir ? git.dirMark(r.entry.path) : git.mark(r.entry.path)) : null
        // The active file keeps its accent; git colours everything else.
        const gitColor = isActive ? null : markColor(mark)
        return (
          <box
            key={r.entry.path}
            height={1}
            flexDirection="row"
            paddingLeft={1}
            backgroundColor={isSel ? (focused ? colors.selectionBg : colors.tabActiveBg) : isHover ? colors.tabActiveBg : undefined}
            onMouseOver={() => setHovered(r.entry.path)}
            onMouseOut={() => setHovered((h) => (h === r.entry.path ? null : h))}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (e.button === RIGHT) {
                tree.select(r.entry.path)
                ws.ui.set({ focus: "tree" })
                openTreeMenu(ws, tree, r, e.x, e.y)
              } else void openRow(idx)
            }}
          >
            <box flexGrow={1} flexShrink={1} overflow="hidden">
              {/* One line, cut with … when the pane is narrow (wrapping hid long names entirely). */}
              <text selectable={false} wrapMode="none" truncate fg={isSel && focused ? colors.text : (gitColor ?? fg)}>
                {" ".repeat(r.depth * 2)}
                {arrow}
                {icon ? <span fg={icon.color}>{icon.glyph} </span> : null}
                {r.entry.name}
              </text>
            </box>
            {mark ? (
              <box width={2} flexShrink={0}>
                <text selectable={false} fg={gitColor ?? colors.dim}>
                  {r.entry.isDir ? " •" : ` ${mark}`}
                </text>
              </box>
            ) : null}
          </box>
        )
      })}
    </box>
  )
}
