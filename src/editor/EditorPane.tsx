import { useCallback, useEffect, useRef, useState } from "react"
import type { LineNumberRenderable, LineSign, TextareaRenderable } from "@opentui/core"
import { changedLines, lineChanges } from "./changeMarkers"
import { colToIndex, indexToCol } from "../lsp/positions"
import { indentGuides, indentUnit, matchBracket, wordOccurrences } from "./decorations"
import { findConflicts } from "./conflicts"
import { setConflicts } from "../git/conflictActions"
import { MergeConflictBar } from "./ConflictBar"
import "./CodeEditorRenderable"
import type { CodeEditorRenderable, LayerHighlight } from "./CodeEditorRenderable"
import { useBuffers, useUi, useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import type { Buffer } from "./BufferStore"
import { getSyntaxStyle } from "./syntaxStyle"
import { Tabs } from "./Tabs"
import { ConflictBar } from "./ConflictBar"
import { FindBar } from "./FindBar"
import { Breadcrumbs } from "./Breadcrumbs"
import { exitMultiEdit } from "./MultiEdit"
import { copySelection, runCommand, type CommandId } from "../keymap/commands"
import type { Workspace } from "../app/workspace"
import { goToDefinition } from "../lsp/lspActions"
import { ImageView } from "../preview/ImageView"
import { MarkdownPreview } from "../preview/MarkdownPreview"

/** The side preview needs this many columns for itself and for the editor beside it. */
export const MIN_SIDE_PREVIEW = 30

function openEditorMenu(ws: Workspace, x: number, y: number): void {
  const hasSel = !!ws.buffers.active?.textarea?.hasSelection()
  const path = ws.buffers.active?.path
  const item = (label: string, hint: string, id: CommandId, disabled = false) => ({
    label,
    hint,
    disabled,
    run: () => runCommand(ws, id),
  })
  ws.ui.set({
    modal: {
      kind: "menu",
      x,
      y,
      items: [
        item("Go to definition", "F12", "lsp.definition", !path || !ws.lsp?.hasServer(path)),
        item("Find all references", "Shift+F12", "lsp.references", !path || !ws.lsp?.hasServer(path)),
        item("Quick fix…", "Alt+.", "lsp.quickFix", !path || !ws.lsp?.hasServer(path)),
        item("Cut", "^X", "edit.cut"),
        item("Copy", "^C", "edit.copy"),
        item("Paste", "^V", "edit.paste"),
        item("Select all", "^A", "edit.selectAll"),
        item(hasSel ? "Send selection to AI" : "Send file to AI", "^L", "ai.sendContext", !ws.ai),
        item("AI: explain this", "", "ai.explain", !ws.ai),
        item("AI: find and fix bugs", "", "ai.fix", !ws.ai),
        item("AI: write tests", "", "ai.tests", !ws.ai),
        ...(ws.buffers.active?.filetype === "markdown"
          ? [item("Open preview", "Alt+Shift+V", "markdown.openPreview"), item("Open preview to the side", "^K V", "markdown.togglePreviewSide")]
          : []),
      ],
    },
  })
}

const DIAG_HL_REF = 0xd1a6
let diagStyleIds: { error: number; warn: number; info: number } | null = null
function diagnosticStyles() {
  if (!diagStyleIds) {
    const style = getSyntaxStyle()
    diagStyleIds = {
      error: style.registerStyle("diag.error", { fg: colors.error, underline: true }),
      warn: style.registerStyle("diag.warn", { fg: colors.warn, underline: true }),
      info: style.registerStyle("diag.info", { underline: true }),
    }
  }
  return diagStyleIds
}

const DECOR_REF = 0xdec0
const INDENT_REF = 0x1de7
/** Lines either side of the cursor searched for its matching bracket and word. */
const DECOR_RADIUS = 400
let decorStyleIds: { bracket: number; word: number; indent: number } | null = null
function decorStyles() {
  if (!decorStyleIds) {
    const style = getSyntaxStyle()
    decorStyleIds = {
      bracket: style.registerStyle("decor.bracket", { bg: colors.bracketMatchBg, bold: true }),
      word: style.registerStyle("decor.word", { bg: colors.wordOccurrenceBg }),
      indent: style.registerStyle("decor.indent", { bg: colors.indentGuideBg }),
    }
  }
  return decorStyleIds
}

const WELCOME: [string, string][] = [
  ["Ctrl+P", "Go to file"],
  ["Ctrl+B", "File tree"],
  ["Ctrl+J", "Ask the AI"],
  ["Ctrl+L", "Send file to the AI"],
  ["F1", "All commands"],
]

function BufferView({ buf, active, focused, wrap }: { buf: Buffer; active: boolean; focused: boolean; wrap: boolean }) {
  const ws = useWorkspace()
  const id = buf.id
  // Set below, once onContent exists; undo/redo are content changes too.
  const onContentRef = useRef(() => {})
  const activeRef = useRef(active)
  activeRef.current = active
  const stale = useRef(false)
  const ref = useCallback(
    (r: CodeEditorRenderable | null) => {
      editorRef.current = r
      ws.buffers.attach(id, r as TextareaRenderable | null)
      if (r) {
        r.autoIndent = ws.config.editor.autoIndent
        r.autoClosingBrackets = ws.config.editor.autoClosingBrackets
        r.onPointer = (e) => {
          if (e.type === "down") exitMultiEdit(ws)
          ws.buffers.onCursorChange(id)
          const ui = ws.ui.get()
          if (ui.focus !== "editor") ws.ui.set({ focus: "editor" })
          // Clicking the text takes the keyboard back from the find bar (it stays open).
          if (ui.find?.active) ws.ui.set({ find: { ...ui.find, active: false } })
          if (e.type === "up" && ws.config.editor.copyOnSelect && r.hasSelection()) void copySelection(ws, { quiet: true })
        }
        r.onHistory = () => onContentRef.current()
        r.onDefinitionClick = (row, col) => {
          exitMultiEdit(ws)
          ws.ui.set({ focus: "editor" })
          void goToDefinition(ws, { row, col })
        }
        r.onContextMenu = (e) => {
          ws.buffers.onCursorChange(id)
          ws.ui.set({ focus: "editor" })
          openEditorMenu(ws, e.x, e.y)
        }
      }
    },
    [ws, id],
  )
  const editorRef = useRef<CodeEditorRenderable | null>(null)
  const lineRef = useRef<LineNumberRenderable | null>(null)
  const gutterAnchor = useRef<number | null>(null)

  // Line signs: git change markers after the number, diagnostics before it.
  const gitSigns = useRef(new Map<number, LineSign>())
  const diagSigns = useRef(new Map<number, LineSign>())
  const applySigns = useCallback(() => {
    const ln = lineRef.current
    if (!ln || ln.isDestroyed) return
    const path = ws.buffers.byId(id)?.path
    const withDiag = !!path && !!ws.lsp?.hasServer(path)
    // Blank signs on line 0 keep the columns' width fixed, so text never shifts.
    const signs = new Map<number, LineSign>([[0, withDiag ? { before: " ", after: " " } : { after: " " }]])
    for (const [l, s] of gitSigns.current) signs.set(l, { ...signs.get(l), ...s })
    for (const [l, s] of diagSigns.current) signs.set(l, { ...signs.get(l), ...s })
    ln.setLineSigns(signs)
  }, [ws, id])

  // Change markers: lines added / modified / deleted since the last commit, live while typing.
  const markTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshMarkers = useCallback(() => {
    if (markTimer.current) clearTimeout(markTimer.current)
    markTimer.current = setTimeout(async () => {
      const path = ws.buffers.byId(id)?.path
      if (!path || !ws.git) return
      // Against the index, like VS Code: staged changes drop their markers.
      const base = await ws.git.indexText(path)
      const ta = editorRef.current
      if (!ta || ta.isDestroyed) return
      const signs = new Map<number, LineSign>()
      if (base !== null) {
        for (const [line, change] of lineChanges(base.replace(/\r\n/g, "\n"), ta.plainText)) {
          const color = change === "add" ? colors.gitAdd : change === "mod" ? colors.gitMod : colors.gitDel
          signs.set(line, { after: change === "del" ? "▁" : "▎", afterColor: color })
        }
      }
      gitSigns.current = signs
      applySigns()
    }, 150)
  }, [ws, id, applySigns])

  // Diagnostics from the language server: a dot before the line number, underlined ranges.
  const shownDiags = useRef<readonly unknown[] | null>(null)
  const refreshDiagnostics = useCallback(() => {
    const ta = editorRef.current
    const path = ws.buffers.byId(id)?.path
    if (!ta || ta.isDestroyed || !path || !ws.lsp) return
    const diags = ws.lsp.diagnostics(path)
    // Updates for other files land here too; this file's list is replaced only when it changes.
    if (diags === shownDiags.current) return
    shownDiags.current = diags
    const lines = ta.plainText.split("\n")
    const ids = diagnosticStyles()
    ta.removeHighlightsByRef(DIAG_HL_REF)
    const signs = new Map<number, LineSign>()
    // Most severe first, so a line shows its worst problem.
    for (const d of [...diags].sort((a, b) => (b.severity ?? 1) - (a.severity ?? 1))) {
      const sev = d.severity ?? 1
      const color = sev === 1 ? colors.error : sev === 2 ? colors.warn : colors.accent
      signs.set(d.range.start.line, { before: "●", beforeColor: color })
      for (let l = d.range.start.line; l <= Math.min(d.range.end.line, lines.length - 1); l++) {
        const text = lines[l] ?? ""
        const from = l === d.range.start.line ? indexToCol(text, d.range.start.character) : 0
        let to = l === d.range.end.line ? indexToCol(text, d.range.end.character) : Bun.stringWidth(text)
        if (to <= from) to = from + 1 // zero-width ranges still get a visible mark
        ta.addHighlight(l, { start: from, end: to, styleId: sev === 1 ? ids.error : sev === 2 ? ids.warn : ids.info, hlRef: DIAG_HL_REF, priority: 8 })
      }
    }
    diagSigns.current = signs
    applySigns()
    ta.requestRender()
  }, [ws, id, applySigns])

  // Cursor decorations: current line, matching bracket, other uses of the word under the cursor.
  const currentRow = useRef(-1)
  const decorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const decorateCursor = useCallback(() => {
    if (decorTimer.current) clearTimeout(decorTimer.current)
    decorTimer.current = setTimeout(() => {
      const ta = editorRef.current
      const ln = lineRef.current
      if (!ta || !ln || ta.isDestroyed || ln.isDestroyed) return
      ta.removeHighlightsByRef(DECOR_REF)
      if (currentRow.current >= 0 && !conflictRows.current.includes(currentRow.current)) ln.clearLineColor(currentRow.current)
      if (!ws.config.editor.highlightCursor || ws.buffers.active?.id !== id) return ta.requestRender()
      const { row, col } = ta.logicalCursor
      currentRow.current = row
      // Both keys: OpenTUI treats an object without "gutter" as a colour string and throws.
      if (!ta.hasSelection() && !conflictRows.current.includes(row)) ln.setLineColor(row, { gutter: colors.currentLineBg, content: colors.currentLineBg })
      // Brackets and word matches near the cursor only: reading the whole file on every move lags big files.
      const from = Math.max(0, row - DECOR_RADIUS)
      const lines = ta.lineRange(from, row + DECOR_RADIUS)
      const r = row - from
      const index = colToIndex(lines[r] ?? "", col)
      const ids = decorStyles()
      const at = (l: number, i: number) => indexToCol(lines[l] ?? "", i)
      for (const c of matchBracket(lines, r, index) ?? [])
        ta.addHighlight(from + c.line, { start: at(c.line, c.index), end: at(c.line, c.index) + 1, styleId: ids.bracket, hlRef: DECOR_REF, priority: 5 })
      if (!ta.hasSelection())
        for (const o of wordOccurrences(lines, r, index))
          ta.addHighlight(from + o.line, { start: at(o.line, o.start), end: at(o.line, o.end), styleId: ids.word, hlRef: DECOR_REF, priority: 5 })
      ta.requestRender()
    }, 30)
  }, [ws, id])

  // Indent guides only change with the text, so they are kept apart from cursor decorations.
  const indentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drawIndentGuides = useCallback(() => {
    if (indentTimer.current) clearTimeout(indentTimer.current)
    indentTimer.current = setTimeout(() => {
      const ta = editorRef.current
      if (!ta || ta.isDestroyed) return
      if (!ws.config.editor.indentGuides) return ta.clearHighlightLayer(INDENT_REF)
      const lines = ta.plainText.split("\n")
      if (lines.length > 50_000) return ta.clearHighlightLayer(INDENT_REF)
      const styleId = decorStyles().indent
      const guides: LayerHighlight[] = []
      indentGuides(lines, indentUnit(lines)).forEach((cols, line) => {
        for (const c of cols) guides.push({ line, start: c, end: c + 1, styleId, priority: 5 })
      })
      ta.setHighlightLayer(INDENT_REF, guides)
    }, 400) // guides don't change mid-word; wait for a pause in typing
  }, [ws])

  // Merge conflicts: tint each side, publish the list for the conflict bar.
  const conflictRows = useRef<number[]>([])
  const markConflicts = useCallback(() => {
    const ta = editorRef.current
    const ln = lineRef.current
    if (!ta || !ln || ta.isDestroyed || ln.isDestroyed) return
    for (const r of conflictRows.current) ln.clearLineColor(r)
    const list = findConflicts(ta.plainText)
    const rows: number[] = []
    const paint = (from: number, to: number, color: string) => {
      for (let r = from; r < to; r++) {
        ln.setLineColor(r, { gutter: color, content: color })
        rows.push(r)
      }
    }
    for (const c of list) {
      paint(c.start, c.start + 1, colors.conflictMarkerBg)
      paint(c.start + 1, c.base ?? c.mid, colors.conflictCurrentBg)
      if (c.base !== null) paint(c.base, c.mid, colors.conflictMarkerBg)
      paint(c.mid, c.mid + 1, colors.conflictMarkerBg)
      paint(c.mid + 1, c.end, colors.conflictIncomingBg)
      paint(c.end, c.end + 1, colors.conflictMarkerBg)
    }
    conflictRows.current = rows
    setConflicts(id, list)
  }, [id])
  // Scanning for conflicts reads the whole file: on every key only while there are some,
  // otherwise once typing pauses.
  const conflictCheck = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkConflicts = useCallback(() => {
    if (conflictCheck.current) clearTimeout(conflictCheck.current)
    if (conflictRows.current.length) return markConflicts()
    conflictCheck.current = setTimeout(markConflicts, 300)
  }, [markConflicts])

  // OpenTUI sizes the line-number column from the visible rows only, so files over 99 lines
  // lose their 3-digit numbers. An identity entry for the last line makes it count every line.
  const lastCount = useRef(0)
  const syncGutterWidth = useCallback(() => {
    const ln = lineRef.current
    const ta = editorRef.current
    if (!ln || !ta || ln.isDestroyed || ta.isDestroyed) return
    const n = ta.lineCount
    if (n === lastCount.current) return
    lastCount.current = n
    ln.setLineNumbers(new Map([[n - 1, n]]))
  }, [])

  useEffect(() => {
    markConflicts()
    const conflictTimer = setTimeout(markConflicts, 60)
    decorateCursor()
    drawIndentGuides()
    syncGutterWidth()
    // The text may arrive just after mount (pendingText); check again once it is in.
    const widthTimer = setTimeout(syncGutterWidth, 50)
    refreshMarkers()
    refreshDiagnostics()
    // Hidden tabs skip git and diagnostics updates (one AI edit can bring many) and catch up when shown.
    const offGit = ws.git?.subscribe(() => (activeRef.current ? refreshMarkers() : (stale.current = true)))
    const offLsp = ws.lsp?.subscribe(() => (activeRef.current ? refreshDiagnostics() : (stale.current = true)))
    // After a reload from disk (usually the AI), flash the lines that changed.
    const timers: ReturnType<typeof setTimeout>[] = []
    const offReload = ws.buffers.onReload((bid, before, after) => {
      if (bid !== id) return
      const lines = changedLines(before, after)
      timers.push(
        setTimeout(() => {
          const ln = lineRef.current
          if (!ln || ln.isDestroyed) return
          for (const l of lines) ln.setLineColor(l, { content: colors.reloadBg, gutter: colors.reloadBg })
          timers.push(
            setTimeout(() => {
              if (ln.isDestroyed) return
              lines.forEach((l) => ln.clearLineColor(l))
              decorateCursor() // the flash may have covered the current line
            }, 2500),
          )
        }, 0),
      )
    })
    return () => {
      clearTimeout(widthTimer)
      clearTimeout(conflictTimer)
      setConflicts(id, [])
      if (decorTimer.current) clearTimeout(decorTimer.current)
      if (indentTimer.current) clearTimeout(indentTimer.current)
      offGit?.()
      offLsp?.()
      offReload()
      timers.forEach(clearTimeout)
      if (markTimer.current) clearTimeout(markTimer.current)
      if (conflictCheck.current) clearTimeout(conflictCheck.current)
    }
  }, [ws, id, refreshMarkers, refreshDiagnostics, syncGutterWidth, decorateCursor, drawIndentGuides, markConflicts])

  const onContent = useCallback(() => {
    ws.buffers.onContentChange(id)
    syncGutterWidth()
    refreshMarkers()
    drawIndentGuides()
    checkConflicts()
    decorateCursor()
  }, [ws, id, refreshMarkers, syncGutterWidth, drawIndentGuides, decorateCursor, checkConflicts])
  onContentRef.current = onContent

  useEffect(() => {
    if (!active || !stale.current) return
    stale.current = false
    refreshMarkers()
    refreshDiagnostics()
  }, [active, refreshMarkers, refreshDiagnostics])
  const onCursor = useCallback(() => {
    ws.buffers.onCursorChange(id)
    decorateCursor()
  }, [ws, id, decorateCursor])

  return (
    <line-number
      ref={lineRef}
      visible={active}
      flexGrow={1}
      minWidth={3}
      paddingRight={1}
      fg={colors.gutterFg}
      bg={colors.gutterBg}
      // Clicks on the gutter (not the text) select whole lines; dragging extends the range.
      onMouseDown={(e) => {
        const ed = editorRef.current
        if (!ed || e.target === ed || e.button !== 0) return
        e.stopPropagation()
        e.preventDefault()
        const line = ed.lineAtScreenY(e.y)
        // A click on a change marker (the column right after the number) opens that change.
        if (e.x === ed.x - 2 && gitSigns.current.has(line)) {
          ws.ui.set({ focus: "editor", hunkPeek: { bufId: id, row: line } })
          return
        }
        gutterAnchor.current = line
        ed.selectLines(line, line)
        ws.ui.set({ focus: "editor" })
        ws.buffers.onCursorChange(id)
      }}
      onMouseDrag={(e) => {
        const ed = editorRef.current
        if (!ed || gutterAnchor.current === null) return
        e.stopPropagation()
        ed.selectLines(gutterAnchor.current, ed.lineAtScreenY(e.y))
        ws.buffers.onCursorChange(id)
      }}
      onMouseUp={() => {
        gutterAnchor.current = null
      }}
    >
      <code-editor
        ref={ref}
        flexGrow={1}
        // The renderer handles `focused` for every element; extended elements just lack the typing.
        {...({ focused } as object)}
        wrapMode={wrap ? "word" : "none"}
        // Select exactly what the cursor passed over (VS Code style), not the cell under it.
        selectionOccupancy="boundary"
        syntaxStyle={getSyntaxStyle()}
        backgroundColor={colors.bg}
        focusedBackgroundColor={colors.bg}
        textColor={colors.text}
        focusedTextColor={colors.text}
        selectionBg={colors.selectionBg}
        cursorColor={colors.cursor}
        onContentChange={onContent}
        onCursorChange={onCursor}
      />
    </line-number>
  )
}

export function EditorPane() {
  const ws = useWorkspace()
  const ui = useUi()
  const buffers = useBuffers()
  const list = buffers.list()
  const active = buffers.active
  const [paneWidth, setPaneWidth] = useState(0)
  const paneFocused = ui.focus === "editor" && !ui.modal
  // The text area gives up the keyboard while the find bar has it.
  const focused = paneFocused && !ui.find?.active

  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={colors.bg}
      // Clicks anywhere in the pane focus it, including when no file is open
      // (the text area and tabs handle their own clicks).
      onMouseDown={(e) => {
        if (e.button === 0 && ws.ui.get().focus !== "editor") ws.ui.set({ focus: "editor" })
      }}
    >
      <Tabs focused={paneFocused} />
      {active ? <Breadcrumbs reveal={(p) => ws.ui.set({ revealPath: p, focus: "tree", treeVisible: true })} /> : null}
      {active?.kind === "text" && (active.conflict || active.deleted) ? <ConflictBar buf={active} /> : null}
      {active?.kind === "text" ? <MergeConflictBar bufId={active.id} /> : null}
      {ui.find && active?.kind === "text" ? <FindBar /> : null}
      {list.length === 0 ? (
        <box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
          <box flexDirection="column">
            <box height={2}>
              <text selectable={false} fg={colors.text}>
                No file open
              </text>
            </box>
            {WELCOME.map(([k, label]) => (
              <box key={k} height={1} flexDirection="row">
                <box width={9} flexShrink={0}>
                  <text selectable={false} fg={colors.accent}>
                    {k}
                  </text>
                </box>
                <text selectable={false} fg={colors.dim}>
                  {label}
                </text>
              </box>
            ))}
          </box>
        </box>
      ) : (
        <box
          flexGrow={1}
          flexDirection="row"
          onSizeChange={function (this: { width: number }) {
            setPaneWidth(this.width)
          }}
        >
          <box flexGrow={1} flexBasis={0} flexDirection="column">
            {list.map((b) => {
              const on = b.id === active?.id
              if (b.kind === "image") return <ImageView key={b.id} buf={b} active={on} focused={focused && on} />
              if (b.kind === "preview") return <MarkdownPreview key={b.id} path={b.source!} active={on} focused={focused && on} version={b.version} />
              return <BufferView key={b.id} buf={b} active={on} focused={focused && on} wrap={ui.wordWrap} />
            })}
          </box>
          {ui.mdSide && active?.kind === "text" && active.filetype === "markdown" && paneWidth >= 2 * MIN_SIDE_PREVIEW + 1 ? (
            <>
              <box width={1} flexShrink={0} backgroundColor={colors.divider} />
              <MarkdownPreview key={`side:${active.path}`} path={active.path} active focused={false} />
            </>
          ) : null}
        </box>
      )}
    </box>
  )
}
