import { useEffect, useRef, useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useUi, useWorkspace, type Workspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { lineAt, type CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import type { CompletionItem } from "./LspManager"
import { colToIndex, indexToCol, wordBefore } from "./positions"

/** LSP CompletionItemKind → a short tag. */
const KIND: Record<number, string> = {
  1: "txt", 2: "fn", 3: "fn", 4: "new", 5: "fld", 6: "var", 7: "cls", 8: "int", 9: "mod", 10: "prop",
  12: "val", 13: "enum", 14: "kw", 15: "snip", 17: "file", 20: "enum", 21: "const", 22: "type", 25: "T",
}

interface State {
  path: string
  row: number
  /** String index where the word being completed starts. */
  start: number
  items: CompletionItem[]
}

const editorOf = (ws: Workspace) => (ws.buffers.active?.textarea ?? null) as CodeEditorRenderable | null

/** Where the cursor is, as the server sees it. */
function cursorContext(ws: Workspace) {
  const ed = editorOf(ws)
  const buf = ws.buffers.active
  if (!ed || !buf) return null
  const { row, col } = ed.logicalCursor
  const line = lineAt(ed, row)
  const index = colToIndex(line, col)
  return { ed, buf, row, line, index, ...wordBefore(line, index) }
}

function filterItems(items: CompletionItem[], word: string): CompletionItem[] {
  const w = word.toLowerCase()
  const key = (i: CompletionItem) => (i.filterText ?? i.label).toLowerCase()
  const starts = items.filter((i) => key(i).startsWith(w))
  const contains = w ? items.filter((i) => !key(i).startsWith(w) && key(i).includes(w)) : []
  const sort = (a: CompletionItem, b: CompletionItem) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label)
  return [...starts.sort(sort), ...contains.sort(sort)].slice(0, 200)
}

/** Ctrl+Space, or typing after "." / two word characters: request completions. */
async function triggerCompletion(ws: Workspace, set: (s: State | null) => void, explicit: boolean): Promise<void> {
  const c = cursorContext(ws)
  if (!c || !ws.lsp?.hasServer(c.buf.path)) {
    if (explicit) ws.notify("No language server for this file", "warn")
    return
  }
  const items = await ws.lsp.completion(c.buf.path, { line: c.row, character: c.index }, c.ed.plainText)
  // The user may have moved on while the server was thinking.
  const now = cursorContext(ws)
  if (!now || now.row !== c.row || now.start !== c.start || now.buf.id !== c.buf.id) return
  if (!items.length) {
    if (explicit) ws.notify("No suggestions")
    return set(null)
  }
  set({ path: c.buf.path, row: c.row, start: c.start, items })
}

let openExplicitly: (() => void) | null = null
let visible = false
/** True while the list is on screen, so Tab and Enter go to it rather than the editor. */
export const completionVisible = () => visible
/** Command entry point (Ctrl+Space). */
export function completeNow(): void {
  openExplicitly?.()
}

/**
 * Autocomplete list under the cursor. Non-modal: typing continues in the editor and filters
 * the list; ↑↓ choose, Enter/Tab accept, Esc closes.
 */
export function CompletionPopup() {
  const ws = useWorkspace()
  const ui = useUi()
  const dims = useTerminalDimensions()
  const [state, setState] = useState<State | null>(null)
  const [sel, setSel] = useState(0)
  const [word, setWord] = useState("")
  const stateRef = useRef<State | null>(null)
  stateRef.current = state

  const set = (s: State | null) => {
    setState(s)
    setSel(0)
    if (s) setWord(cursorContext(ws)?.word ?? "")
  }

  useEffect(() => {
    openExplicitly = () => void triggerCompletion(ws, set, true)
    return () => {
      openExplicitly = null
    }
  })

  // Follow typing: refilter, close when the cursor leaves the word, auto-trigger.
  useEffect(
    () =>
      ws.buffers.onText((id) => {
        if (id !== ws.buffers.active?.id || ws.ui.get().focus !== "editor") return
        const c = cursorContext(ws)
        if (!c) return
        const cur = stateRef.current
        if (cur && cur.row === c.row && cur.start === c.start && cur.path === c.buf.path) {
          setWord(c.word)
          setSel(0)
          return
        }
        const before = c.line[c.start - 1]
        const auto = (before === "." && c.word.length === 0) || c.word.length === 2
        if (cur) set(null)
        if (auto && ws.config.editor.autocomplete) void triggerCompletion(ws, set, false)
      }),
    [ws],
  )

  // Close on tab switch, focus change, or when a modal opens.
  useEffect(() => {
    if (state && (ui.focus !== "editor" || ui.modal || ws.buffers.active?.path !== state.path)) set(null)
  })

  const items = state ? filterItems(state.items, word) : []

  const accept = (item: CompletionItem | undefined) => {
    const c = cursorContext(ws)
    if (!item || !c || !state) return set(null)
    const text = item.textEdit?.newText ?? item.insertText ?? item.label
    c.ed.replaceRange(c.row, indexToCol(c.line, state.start), indexToCol(c.line, c.index), text)
    ws.buffers.onContentChange(c.buf.id)
    set(null)
  }

  useKeyboard((key) => {
    if (!state || !items.length || ui.modal) return
    let handled = true
    if (key.name === "escape") set(null)
    else if (key.name === "down") setSel((s) => (s + 1) % items.length)
    else if (key.name === "up") setSel((s) => (s - 1 + items.length) % items.length)
    else if (key.name === "pagedown") setSel((s) => Math.min(items.length - 1, s + 8))
    else if (key.name === "pageup") setSel((s) => Math.max(0, s - 8))
    else if ((key.name === "return" || key.name === "tab") && !key.ctrl && !key.meta) accept(items[sel])
    else handled = false
    if (handled) {
      key.preventDefault()
      key.stopPropagation()
    }
  })

  visible = !!state && items.length > 0
  if (!state || !items.length) return null
  const ed = editorOf(ws)
  const pos = ed?.cursorScreenPos()
  if (!pos) return null
  const height = Math.min(10, items.length)
  const top = Math.max(0, Math.min(sel - height + 1, items.length - height))
  const width = Math.min(60, Math.max(24, ...items.slice(top, top + height).map((i) => i.label.length + 8 + (i.detail ? Math.min(24, i.detail.length) : 0))))
  // Under the cursor when it fits, else above it; aligned with the word's start.
  const below = pos.y + 1 + height <= dims.height - 1
  const y = below ? pos.y + 1 : Math.max(0, pos.y - height)
  const c = cursorContext(ws)
  const wordX = pos.x - (c ? Bun.stringWidth(c.word) : 0)
  const x = Math.max(0, Math.min(wordX - 5, dims.width - width))

  return (
    <box position="absolute" left={x} top={y} width={width} height={height} zIndex={150} backgroundColor={colors.panelBg} flexDirection="column">
      {items.slice(top, top + height).map((it, i) => {
        const idx = top + i
        const active = idx === sel
        return (
          <box
            key={`${it.label}:${idx}`}
            height={1}
            flexDirection="row"
            backgroundColor={active ? colors.selectionBg : undefined}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              accept(it)
            }}
          >
            <box width={5} flexShrink={0}>
              <text selectable={false} fg={colors.dim}>
                {" " + (KIND[it.kind ?? 0] ?? "")}
              </text>
            </box>
            <box flexGrow={1} overflow="hidden">
              <text selectable={false} fg={active ? colors.text : colors.text}>
                {it.label}
              </text>
            </box>
            {it.detail || it.labelDetails?.description ? (
              <box flexShrink={1} overflow="hidden" paddingRight={1}>
                <text selectable={false} fg={colors.dim}>
                  {(it.labelDetails?.description ?? it.detail ?? "").slice(0, 24)}
                </text>
              </box>
            ) : null}
          </box>
        )
      })}
    </box>
  )
}
