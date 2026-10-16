import { useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { Modal } from "./Modal"
import { useWorkspace } from "./workspace"
import { commands, type CommandId } from "../keymap/commands"
import type { buildBindings, Layer } from "../keymap/bindings"
import { ui as colors } from "../config/theme"
import { prettyKeys } from "../keymap/keys"
import { closeModal } from "./modalStack"

const pretty = prettyKeys

type Line = { kind: "head"; text: string } | { kind: "row"; key: string; text: string } | { kind: "gap" }

const TREE: [string, string][] = [
  ["↑ ↓ ← →", "Move, expand, collapse"],
  ["Enter", "Open file / toggle folder"],
  ["A", "New file (a/b.ts makes folders)"],
  ["Shift+A", "New folder"],
  ["R / F2", "Rename"],
  ["Delete", "Delete (asks first)"],
  ["Right-click", "More: copy path, send to AI"],
]

const MOUSE: [string, string][] = [
  ["Click", "Focus a pane, place the cursor"],
  ["Drag border", "Resize panes (remembered)"],
  ["Line numbers", "Click or drag to select lines"],
  ["Ctrl+click", "Go to definition (or Alt+click)"],
  ["Right-click", "Menu in editor, tree, AI pane"],
  ["Shift+drag", "Terminal's own text selection"],
]

const TIPS: [string, string][] = [
  ["! cmd", "In Claude: run a shell command"],
  ["▎ in gutter", "Changed since last commit"],
]

// VS Code keys a terminal can't send, and what to press instead.
const VSCODE: [string, string][] = [
  ["Ctrl+Shift+K", "Alt+Shift+K (delete line)"],
  ["Ctrl+Shift+L", "Ctrl+Alt+A (all occurrences)"],
  ["Ctrl+H", "Ctrl+F twice (replace)"],
  ["Ctrl+Shift+F", "Ctrl+Alt+F (search files)"],
  ["Ctrl+Shift+H", "Ctrl+Alt+F, Ctrl+F (replace in files)"],
  ["Ctrl+.", "Alt+. (quick fix)"],
  ["Ctrl+Shift+T", "Ctrl+Alt+T (reopen tab)"],
  ["Ctrl+Tab", "Ctrl+PgDn, or Alt+1…9"],
  ["Ctrl+`", "Ctrl+J, then !command"],
]

/** Grouped, scrollable cheat sheet. Columns side by side when the terminal is wide enough. */
export function HelpModal({ bindings }: { bindings: ReturnType<typeof buildBindings> }) {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const [top, setTop] = useState(0)

  // Alt+1..9 share one row.
  const keys = (layer: Layer): [string, string][] =>
    [...bindings[layer]]
      .filter(([, id]) => !/^buffer\.goto[2-9]$/.test(id))
      .map(([key, id]) => (id === "buffer.goto1" ? [`${pretty(key)}…9`, "Go to tab 1–9 (9: the last)"] : [pretty(key), commands[id as CommandId].title]))
  // The AI pane only lets a few keys through; list just the ones that differ from General.
  const aiOnly = keys("ai").filter(([k]) => !bindings.global.has(k.toLowerCase()))

  const section = (title: string, rows: [string, string][]): Line[] => [
    { kind: "head", text: title },
    ...rows.map(([key, text]): Line => ({ kind: "row", key, text })),
    { kind: "gap" },
  ]
  const left = [...section("General", keys("global")), ...section("Editor", keys("editor"))]
  const right = [
    ...section("File tree (when focused)", TREE),
    ...section("AI pane (other keys go to the AI)", aiOnly),
    ...section("Mouse", MOUSE),
    ...section("Tips", TIPS),
    ...section("From VS Code (keys terminals can't send)", VSCODE),
  ]

  const twoCols = dims.width >= 124
  const colW = twoCols ? 58 : Math.min(64, dims.width - 8)
  const columns = twoCols ? [left, right] : [[...left, ...right]]
  const tallest = Math.max(...columns.map((c) => c.length))
  const viewH = Math.max(3, Math.min(tallest, dims.height - 6))
  const maxTop = Math.max(0, tallest - viewH)
  const scroll = (d: number) => setTop((t) => Math.max(0, Math.min(maxTop, t + d)))

  useKeyboard((key) => {
    key.preventDefault()
    key.stopPropagation()
    if (key.name === "up" || key.name === "k") scroll(-1)
    else if (key.name === "down" || key.name === "j") scroll(1)
    else if (key.name === "pageup") scroll(-viewH)
    else if (key.name === "pagedown" || key.name === "space") scroll(viewH)
    else if (key.name === "escape" || key.name === "return" || key.name === "q" || key.name === "f1") closeModal(ws)
  })

  const render = (l: Line, i: number) => {
    if (l.kind === "gap") return <box key={i} height={1} />
    if (l.kind === "head")
      return (
        <box key={i} height={1}>
          <text selectable={false} fg={colors.warn}>
            {l.text}
          </text>
        </box>
      )
    return (
      <box key={i} height={1} flexDirection="row" overflow="hidden">
        <box width={16} flexShrink={0}>
          <text selectable={false} fg={colors.accent}>
            {l.key}
          </text>
        </box>
        <text selectable={false} fg={colors.text}>
          {l.text}
        </text>
      </box>
    )
  }

  const more = maxTop > 0 ? ` ${top + viewH < tallest ? "↓" : ""}${top > 0 ? "↑" : ""} scroll` : ""
  return (
    <Modal
      title={`Shortcuts (Esc to close)${more}`}
      width={twoCols ? colW * 2 + 6 : colW + 4}
      height={viewH + 4}
      onClose={() => closeModal(ws)}
    >
      <box
        flexDirection="row"
        gap={2}
        onMouseScroll={(e) => {
          e.stopPropagation()
          scroll(e.scroll?.direction === "up" ? -3 : 3)
        }}
      >
        {columns.map((col, c) => (
          <box key={c} width={colW} flexDirection="column">
            {col.slice(top, top + viewH).map(render)}
          </box>
        ))}
      </box>
    </Modal>
  )
}
