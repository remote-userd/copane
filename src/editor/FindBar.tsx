import { useEffect, useMemo, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { InputRenderable } from "@opentui/core"
import { useBuffers, useUi, useWorkspace, useCursorStyle, useKeyText } from "../app/workspace"
import { HoverBox } from "../app/Modal"
import { ui as colors } from "../config/theme"
import type { Workspace } from "../app/workspace"
import type { CodeEditorRenderable } from "./CodeEditorRenderable"
import { extraStyle } from "./syntaxStyle"
import { colToIndex } from "../lsp/positions"
import { findAll, isCaseSensitive, nearestMatch, replaceMatches, type Match } from "./search"
import { replaceSeed, selectAllSoon } from "../app/seededInput"

// Highlight refs are 16-bit in the native buffer (OpenTUI 0.6).
const SEARCH_HL_REF = 0x5ea4
function searchStyles() {
  return {
    match: extraStyle("search.match", { bg: colors.findMatchBg }, { overlay: true }),
    current: extraStyle("search.current", { bg: colors.findCurrentBg }, { overlay: true }),
  }
}

const editorOf = (ws: Workspace) => (ws.buffers.active?.textarea ?? null) as CodeEditorRenderable | null

function clearSearchHighlights(ws: Workspace): void {
  for (const b of ws.buffers.list()) (b.textarea as CodeEditorRenderable | null)?.clearHighlightLayer(SEARCH_HL_REF)
}

/** Open the find bar (Ctrl+F / Ctrl+H), seeding it with a one-line selection or the word under the cursor. */
export function openFind(ws: Workspace, replace: boolean): void {
  const ed = editorOf(ws)
  if (!ed) return ws.notify("No file open", "warn")
  const ui = ws.ui.get()
  // Like VS Code: the selection, or else the word under the cursor (not when Ctrl+F only toggles replace).
  const sel = ed.hasSelection() ? ed.getSelectedText() : ui.find?.active ? "" : wordUnderCursor(ed)
  const seed = (ui.find?.seed ?? 0) + 1
  // Ctrl+F while the bar is already focused toggles the replace row (Ctrl+H is Backspace in terminals).
  const withReplace = replace || (ui.find?.active ? !ui.find.replace : !!ui.find?.replace)
  // Incremental search starts from where the cursor was when the bar opened (selection start).
  const { row, col } = ed.logicalCursor
  const anchor = ui.find?.anchor ?? { row, col: sel && !sel.includes("\n") ? Math.max(0, col - Bun.stringWidth(sel)) : col }
  ws.ui.set({
    focus: "editor",
    find: { replace: withReplace, active: true, seed, anchor },
    ...(sel && !sel.includes("\n") ? { findQuery: sel } : {}),
  })
}

export function wordUnderCursor(ed: CodeEditorRenderable): string {
  const { row, col } = ed.logicalCursor
  const line = ed.getTextRangeByCoords(row, 0, row, ed.editBuffer.getEOL().col)
  const i = colToIndex(line, col)
  const start = i - (line.slice(0, i).match(/[\w$]*$/)?.[0].length ?? 0)
  const end = i + (line.slice(i).match(/^[\w$]*/)?.[0].length ?? 0)
  return line.slice(start, end)
}

function closeFind(ws: Workspace): void {
  clearSearchHighlights(ws)
  ws.ui.set({ find: null })
}

export function FindBar() {
  const cursorStyle = useCursorStyle()
  const ws = useWorkspace()
  const kt = useKeyText()
  const ui = useUi()
  const buffers = useBuffers()
  const find = ui.find!
  const buf = buffers.active
  const [textVersion, setTextVersion] = useState(0)
  const [current, setCurrent] = useState(-1)
  const findInput = useRef<InputRenderable | null>(null)
  const replaceInput = useRef<InputRenderable | null>(null)
  const [field, setField] = useState<"find" | "replace">("find")

  // Each Ctrl+F selects the query, so the first key typed replaces the seeded word.
  const fresh = useRef(false)
  useEffect(() => {
    fresh.current = !!ui.findQuery
    return selectAllSoon(findInput)
    // Only on each Ctrl+F.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find.seed])

  // Re-search when the text changes (typing in the editor, undo, an AI edit reloading the file),
  // once edits pause: each search scans the whole file.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = ws.buffers.onText((id) => {
      if (id !== ws.buffers.active?.id) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setTextVersion((v) => v + 1), 60)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [ws])

  const matches: Match[] = useMemo(() => {
    const ed = editorOf(ws)
    return ed ? findAll(ed.plainText, ui.findQuery) : []
    // textVersion and buf are the triggers for recomputing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, ui.findQuery, textVersion, buf?.id])

  // Jump to the nearest match as the query changes (incremental search).
  useEffect(() => {
    const ed = editorOf(ws)
    if (!ed || !matches.length) return setCurrent(-1)
    const { row, col } = find.anchor
    const i = nearestMatch(matches, row, col)
    setCurrent(i)
    const m = matches[i]!
    ed.selectRange(m.line, m.startCol, m.endCol)
    // Only when the query itself changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.findQuery, buf?.id])

  // Paint all matches, the current one brighter. As a layer, only those near the viewport are
  // drawn, and moving to the next match redraws just two lines.
  useEffect(() => {
    const ed = editorOf(ws)
    if (!ed) return
    const ids = searchStyles()
    ed.setHighlightLayer(
      SEARCH_HL_REF,
      matches.map((m, i) => ({ line: m.line, start: m.startCol, end: m.endCol, styleId: i === current ? ids.current : ids.match, priority: 10 })),
    )
  }, [ws, matches, current])

  useEffect(() => () => clearSearchHighlights(ws), [ws])

  const go = (delta: number) => {
    const ed = editorOf(ws)
    if (!ed || !matches.length) return
    const i = current === -1 ? nearestMatch(matches, ed.logicalCursor.row, ed.logicalCursor.col) : (current + delta + matches.length) % matches.length
    setCurrent(i)
    const m = matches[i]!
    ed.selectRange(m.line, m.startCol, m.endCol)
    ws.buffers.onCursorChange(ws.buffers.active!.id)
  }

  const replace = (all: boolean) => {
    const ed = editorOf(ws)
    if (!ed || !matches.length) return
    const text = replaceMatches(ed.plainText, matches, ui.replaceWith, all ? undefined : Math.max(0, current))
    const keep = current
    ws.buffers.replaceText(ws.buffers.active!, text) // one undo step
    if (all) ws.notify(`Replaced ${matches.length} match${matches.length === 1 ? "" : "es"}`)
    else {
      // Stay on the same index: it now points at the next match.
      const next = findAll(text, ui.findQuery)
      if (next.length) {
        const i = Math.min(keep, next.length - 1)
        setCurrent(i)
        ed.selectRange(next[i]!.line, next[i]!.startCol, next[i]!.endCol)
      }
    }
  }

  useKeyboard((key) => {
    if (!find.active || ui.modal) return
    if (fresh.current && field === "find") {
      fresh.current = false
      if (replaceSeed(key, findInput.current, () => ws.ui.set({ findQuery: "" }))) return
    }
    let handled = true
    if (key.name === "escape") closeFind(ws)
    else if (key.name === "tab" && find.replace) setField((f) => (f === "find" ? "replace" : "find"))
    else if (key.name === "return" && field === "replace") replace(key.meta || key.ctrl)
    else if (key.name === "return") go(key.shift ? -1 : 1)
    else if (key.name === "down") go(1)
    else if (key.name === "up") go(-1)
    else handled = false
    if (handled) {
      key.preventDefault()
      key.stopPropagation()
    }
  })

  const focusBar = (f: "find" | "replace") => {
    setField(f)
    if (!find.active) ws.ui.set({ find: { ...find, active: true }, focus: "editor" })
  }

  const count = !ui.findQuery ? "" : matches.length ? `${current + 1}/${matches.length}` : "no results"
  const caseNote = ui.findQuery && isCaseSensitive(ui.findQuery) ? "Aa" : ""
  const inputStyle = { backgroundColor: colors.bg, focusedBackgroundColor: colors.bg, textColor: colors.text, focusedTextColor: colors.text }

  return (
    <box flexDirection="column" flexShrink={0} backgroundColor={colors.panelBg} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" height={1} gap={1}>
        <box width={8} flexShrink={0}>
          <text selectable={false} fg={colors.dim}>
            Find
          </text>
        </box>
        <box flexGrow={1} onMouseDown={() => focusBar("find")}>
          <input
            cursorStyle={cursorStyle}
            key={`f${find.seed}`}
            ref={findInput}
            value={ui.findQuery}
            placeholder="text (smart case)"
            focused={find.active && field === "find" && !ui.modal}
            {...inputStyle}
            onInput={(v: string) => ws.ui.set({ findQuery: v })}
          />
        </box>
        <text selectable={false} fg={matches.length || !ui.findQuery ? colors.dim : colors.error}>
          {count}
        </text>
        {caseNote ? (
          <text selectable={false} fg={colors.accent}>
            {caseNote}
          </text>
        ) : null}
        <HoverBox onPress={() => go(-1)}>
          <text selectable={false} fg={colors.text}>
            ↑
          </text>
        </HoverBox>
        <HoverBox onPress={() => go(1)}>
          <text selectable={false} fg={colors.text}>
            ↓
          </text>
        </HoverBox>
        <HoverBox onPress={() => closeFind(ws)}>
          <text selectable={false} fg={colors.dim}>
            ×
          </text>
        </HoverBox>
      </box>
      {find.replace ? (
        <box flexDirection="row" height={1} gap={1}>
          <box width={8} flexShrink={0}>
            <text selectable={false} fg={colors.dim}>
              Replace
            </text>
          </box>
          <box flexGrow={1} onMouseDown={() => focusBar("replace")}>
            <input
              cursorStyle={cursorStyle}
              key={`r${find.seed}`}
              ref={replaceInput}
              value={ui.replaceWith}
              placeholder={kt("replacement (Enter: one, Alt+Enter: all)")}
              focused={find.active && field === "replace" && !ui.modal}
              {...inputStyle}
              onInput={(v: string) => ws.ui.set({ replaceWith: v })}
            />
          </box>
          <HoverBox onPress={() => replace(false)} paddingX={1}>
            <text selectable={false} fg={colors.text}>
              Replace
            </text>
          </HoverBox>
          <HoverBox onPress={() => replace(true)} paddingX={1}>
            <text selectable={false} fg={colors.text}>
              All
            </text>
          </HoverBox>
        </box>
      ) : null}
    </box>
  )
}
