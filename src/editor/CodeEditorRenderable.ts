import { Renderable, TextareaRenderable, type KeyEvent, type MouseEvent, type RenderContext, type TextareaOptions } from "@opentui/core"
import { Glide } from "../app/glide"

export interface LayerHighlight {
  line: number
  start: number
  end: number
  styleId: number
  priority?: number
}
import { extend } from "@opentui/react"
import { colToIndex, indexToCol } from "../lsp/positions"
import { indentUnit } from "./decorations"
import { indentString } from "./lineOps"
import { PAIRS, deletesPair, enterText, homeIndex, isTypingPairChar, typeChar } from "./typing"

const LEFT = 0
const RIGHT = 2

/** The native calls behind OpenTUI's text reads, which cap every read at 1 MB. */
type NativeEditBuffer = {
  lib: {
    textBufferGetByteSize(ptr: unknown): number
    editBufferGetText(ptr: unknown, max: number): Uint8Array | null
    editBufferGetTextRange(ptr: unknown, start: number, end: number, max: number): Uint8Array | null
  }
  bufferPtr: unknown
  textBufferPtr: unknown
}
const decoder = new TextDecoder()

/** One line of an editor's text; cheap for a CodeEditorRenderable, a full read otherwise. */
export function lineAt(ta: { plainText: string }, row: number): string {
  return ta instanceof CodeEditorRenderable ? ta.lineText(row) : (ta.plainText.split("\n")[row] ?? "")
}
type NativeEditorView = {
  lib: { editorViewGetTextBufferView(view: unknown): unknown; textBufferViewGetLineSources(view: unknown, start: number, count: number): number[] }
  viewPtr: unknown
  _textBufferViewPtr?: unknown
}

type NativeHighlight = Parameters<TextareaRenderable["addHighlight"]>[1]
const layerHl = (h: LayerHighlight, ref: number): NativeHighlight => ({ start: h.start, end: h.end, styleId: h.styleId, priority: h.priority, hlRef: ref })

const sameHighlights = (a: readonly LayerHighlight[] | undefined, b: readonly LayerHighlight[] | undefined): boolean => {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.start !== y.start || x.end !== y.end || x.styleId !== y.styleId || x.priority !== y.priority) return false
  }
  return true
}

/** Lines whose highlights differ between two drawn states. */
function changedLines(old: Map<number, LayerHighlight[]>, next: Map<number, LayerHighlight[]>): number[] {
  const out: number[] = []
  for (const [line, list] of next) if (!sameHighlights(old.get(line), list)) out.push(line)
  for (const line of old.keys()) if (!next.has(line)) out.push(line)
  return out
}

type RawMouse = { type: string; button: number; x: number; y: number; modifiers: { ctrl: boolean } }
type MouseRouting = { processSingleMouseEvent(e: RawMouse): boolean; hitTest(x: number, y: number): number; clearSelection(): void }
const routed = new WeakSet<object>()

/**
 * OpenTUI reads Ctrl+click as "extend the selection" whenever the renderer still holds one, which
 * it does after every plain click, and then never delivers the click. So a Ctrl+click on an
 * editor drops that selection first and reaches the editor as go to definition.
 */
function deliverCtrlClicks(ctx: RenderContext): void {
  if (routed.has(ctx)) return
  routed.add(ctx)
  const r = ctx as unknown as MouseRouting
  const process = r.processSingleMouseEvent
  if (typeof process !== "function") return
  r.processSingleMouseEvent = function (e) {
    if (e.type === "down" && e.button === LEFT && e.modifiers.ctrl) {
      const target = Renderable.renderablesByNumber.get(this.hitTest(e.x, e.y))
      if (target instanceof CodeEditorRenderable && target.onDefinitionClick) this.clearSelection()
    }
    return process.call(this, e)
  }
}

/**
 * The editor surface: a textarea with editor-style mouse behaviour.
 * - The wheel scrolls the view without losing the cursor (VS Code style). The native view
 *   insists on keeping its cursor on screen, so while scrolled away the real position is
 *   "parked": the native cursor rides along hidden, everything reading `logicalCursor` sees
 *   the parked one, and the next key or click puts it back (scrolling to it, as VS Code does).
 * - Every pointer interaction is reported so the app can sync the status bar and focus.
 * - Keys behave as in VS Code: Home/End work on the line (Ctrl for the file), PageUp/PageDown
 *   page, Enter keeps the indent, brackets and quotes close themselves.
 */
export class CodeEditorRenderable extends TextareaRenderable {
  /** Called after any mouse interaction that may have moved the cursor or selection. */
  onPointer: ((event: MouseEvent) => void) | null = null
  /** Right-click handler; the cursor has already been placed. */
  onContextMenu: ((event: MouseEvent) => void) | null = null
  /** Undo or redo changed the text. The native buffer reports those only as a cursor move. */
  onHistory: (() => void) | null = null
  /** Ctrl+click (or Alt+click) on text: go to the definition at (row, col). */
  onDefinitionClick: ((row: number, col: number) => void) | null = null
  /** Enter keeps the line's indent (`editor.autoIndent`). */
  autoIndent = true
  /** Brackets and quotes close themselves (`editor.autoClosingBrackets`). */
  autoClosingBrackets = true
  private parked: { row: number; col: number } | null = null

  constructor(ctx: RenderContext, options: TextareaOptions) {
    super(ctx, options)
    deliverCtrlClicks(ctx)
  }

  /**
   * The whole text. OpenTUI's `plainText` stops at 1 MB (saving a bigger file would cut it off)
   * and allocates a 1 MB buffer per read, even for a small file; read at the real size instead.
   */
  override get plainText(): string {
    const eb = this.native()
    if (!eb) return super.plainText
    const size = eb.lib.textBufferGetByteSize(eb.textBufferPtr)
    const bytes = size > 0 ? eb.lib.editBufferGetText(eb.bufferPtr, size) : null
    return bytes ? decoder.decode(bytes) : ""
  }

  /** The text's size in UTF-8 bytes, without reading it (constant time). */
  get byteSize(): number {
    const eb = this.native()
    return eb ? eb.lib.textBufferGetByteSize(eb.textBufferPtr) : new TextEncoder().encode(super.plainText).length
  }

  /** Text between two buffer offsets (end may run past the end), sized like plainText. */
  private textRange(start: number, end: number): string {
    const eb = this.native()
    if (!eb) return this.getTextRange(start, end)
    if (start >= end) return ""
    const total = eb.lib.textBufferGetByteSize(eb.textBufferPtr)
    // An offset unit is at most 4 bytes of UTF-8; a read that fills the guess is retried whole.
    const guess = Math.min(total, (end - start) * 4 + 8)
    let bytes = eb.lib.editBufferGetTextRange(eb.bufferPtr, start, end, Math.max(1, guess))
    if (bytes && bytes.length >= guess && guess < total) bytes = eb.lib.editBufferGetTextRange(eb.bufferPtr, start, end, total)
    return bytes ? decoder.decode(bytes) : ""
  }

  private native(): NativeEditBuffer | null {
    const eb = this.editBuffer as unknown as NativeEditBuffer
    return typeof eb.lib?.textBufferGetByteSize === "function" && typeof eb.lib.editBufferGetTextRange === "function" ? eb : null
  }

  override undo(): boolean {
    const done = super.undo()
    this.onHistory?.()
    return done
  }

  override redo(): boolean {
    const done = super.redo()
    this.onHistory?.()
    return done
  }

  /**
   * Source lines for screen rows, read by the line-number gutter every frame. Without this the
   * gutter asks for the line info of the whole file and slices it: thousands of lines per frame.
   */
  getLineSources(startLine: number, lineCount: number): number[] {
    const ev = this.editorView as unknown as NativeEditorView
    if (typeof ev.lib?.textBufferViewGetLineSources !== "function") return this.lineInfo.lineSources.slice(startLine, startLine + lineCount)
    ev._textBufferViewPtr ??= ev.lib.editorViewGetTextBufferView(ev.viewPtr)
    return ev.lib.textBufferViewGetLineSources(ev._textBufferViewPtr, startLine, lineCount)
  }

  /**
   * Highlight layers (syntax colours, indent guides): stored for the whole file, but only the
   * lines around the viewport are handed to the native buffer. Adding tens of thousands of
   * highlights per edit made big files lag for seconds.
   */
  private layers = new Map<number, Map<number, LayerHighlight[]>>()
  private window: { from: number; to: number } | null = null

  setHighlightLayer(ref: number, highlights: readonly LayerHighlight[]): void {
    const byLine = new Map<number, LayerHighlight[]>()
    for (const h of highlights) {
      const list = byLine.get(h.line)
      if (list) list.push(h)
      else byLine.set(h.line, [h])
    }
    this.layers.set(ref, byLine)
    this.window ??= this.windowAround()
    this.drawLayer(ref, this.window)
    this.requestRender()
  }

  clearHighlightLayer(ref: number): void {
    this.layers.delete(ref)
    this.removeHighlightsByRef(ref)
  }

  /** Lines worth highlighting: the viewport plus two screens either side (adding highlights is slow natively). */
  private windowAround(): { from: number; to: number } {
    const vp = this.editorView.getViewport()
    const top = this.wraps ? this.lineAtScreenY(this.y) : vp.offsetY
    const margin = Math.max(60, vp.height * 2)
    return { from: Math.max(0, top - margin), to: top + vp.height + margin }
  }

  /**
   * What the native buffer holds, mirrored here so a layer update can redraw only the lines that
   * changed: typing re-highlights the whole file, but usually only the edited line differs.
   * `drawn` is per layer, `direct` is everything added with plain addHighlight (diagnostics,
   * find matches...). Native highlights stay on their line index through edits, so this mirror
   * stays true until a clear.
   */
  private drawn = new Map<number, Map<number, LayerHighlight[]>>()
  private direct = new Map<number, NativeHighlight[]>()

  override addHighlight(line: number, hl: NativeHighlight): void {
    const list = this.direct.get(line)
    if (list) list.push(hl)
    else this.direct.set(line, [hl])
    super.addHighlight(line, hl)
  }

  override removeHighlightsByRef(ref: number): void {
    this.drawn.delete(ref)
    for (const [line, list] of this.direct) {
      const keep = list.filter((h) => h.hlRef !== ref)
      if (keep.length === 0) this.direct.delete(line)
      else if (keep.length !== list.length) this.direct.set(line, keep)
    }
    super.removeHighlightsByRef(ref)
  }

  override clearLineHighlights(line: number): void {
    this.direct.delete(line)
    for (const byLine of this.drawn.values()) byLine.delete(line)
    super.clearLineHighlights(line)
  }

  override clearAllHighlights(): void {
    this.direct.clear()
    this.drawn.clear()
    super.clearAllHighlights()
  }

  override clear(): void {
    this.direct.clear()
    this.drawn.clear()
    super.clear()
  }

  private drawLayer(ref: number, w: { from: number; to: number }): void {
    const byLine = this.layers.get(ref)
    const next = new Map<number, LayerHighlight[]>()
    const last = Math.min(w.to, this.lineCount - 1)
    if (byLine) {
      for (let line = w.from; line <= last; line++) {
        const list = byLine.get(line)
        if (list) next.set(line, list)
      }
    }
    const old = this.drawn.get(ref)
    const changed = old ? changedLines(old, next) : null
    // A changed line costs a clear plus its highlights, so line by line wins until most of the
    // window changed (a scroll shifts it: lines leaving only need the clear).
    if (!changed || changed.length > Math.max(32, next.size)) {
      super.removeHighlightsByRef(ref)
      this.drawn.set(ref, next)
      for (const [line, list] of next) for (const h of list) super.addHighlight(line, layerHl(h, ref))
      return
    }
    this.drawn.set(ref, next)
    // The native buffer clears a line for every ref at once, so put back the other layers too.
    for (const line of changed) {
      super.clearLineHighlights(line)
      for (const [r, lines] of this.drawn) for (const h of lines.get(line) ?? []) super.addHighlight(line, layerHl(h, r))
      for (const h of this.direct.get(line) ?? []) super.addHighlight(line, h)
    }
  }

  /** Re-draw the layers when scrolling nears the edge of the drawn window. */
  private followWindow(): void {
    if (!this.layers.size || !this.window) return
    const vp = this.editorView.getViewport()
    const top = this.wraps ? this.lineAtScreenY(this.y) : vp.offsetY
    const slack = Math.max(30, vp.height)
    if (top - this.window.from >= slack && this.window.to - (top + vp.height) >= slack) return
    if (this.window.from === 0 && top < slack && this.window.to - (top + vp.height) >= slack) return
    this.window = this.windowAround()
    for (const ref of this.layers.keys()) this.drawLayer(ref, this.window)
  }

  override onUpdate(deltaTime: number): void {
    super.onUpdate(deltaTime)
    this.followWindow()
  }

  override get logicalCursor(): ReturnType<TextareaRenderable["editBuffer"]["getCursorPosition"]> {
    const real = super.logicalCursor
    return this.parked ? { ...real, row: this.parked.row, col: this.parked.col } : real
  }

  /** True while the wheel has scrolled the cursor out of view. */
  get isParked(): boolean {
    return this.parked !== null
  }

  /** Put a parked cursor back where it was, scrolling the view to it. */
  unpark(): void {
    const p = this.parked
    if (!p) return
    this.parked = null
    this.showCursor = true
    super.setCursor(p.row, p.col)
  }

  /** Forget a parked cursor without restoring it (a click is about to place a new one). */
  private dropPark(): void {
    if (!this.parked) return
    this.parked = null
    this.showCursor = true
  }

  override setCursor(row: number, col: number): void {
    this.dropPark()
    super.setCursor(row, col)
  }

  override onMouseEvent(event: MouseEvent): void {
    if (event.button === RIGHT && (event.type === "down" || event.type === "up")) {
      if (event.type === "down") this.openContextMenu(event)
      return
    }
    if (event.button === LEFT && event.type === "down" && (event.modifiers.ctrl || event.modifiers.alt) && this.onDefinitionClick) {
      event.stopPropagation()
      const { row, col } = this.clickPos(event)
      const cb = this.onDefinitionClick
      queueMicrotask(() => cb(row, col))
      return
    }
    if (event.type === "scroll") this.scrollView(event)
    else {
      if (event.type === "down") this.dropPark()
      super.onMouseEvent(event)
    }
    if (this.onPointer && event.type !== "move" && event.type !== "over" && event.type !== "out") {
      const cb = this.onPointer
      // Selection and cursor updates from the renderer land after dispatch.
      queueMicrotask(() => cb(event))
    }
  }

  /** VS Code behaviour: a right-click outside the selection moves the cursor there first. */
  private openContextMenu(event: MouseEvent): void {
    event.stopPropagation()
    this.unpark()
    const { row, col: clampedCol } = this.clickPos(event)
    const offset = this.editBuffer.positionToOffset(row, clampedCol)
    const sel = this.hasSelection() ? this.getSelection() : null
    if (!sel || offset < Math.min(sel.start, sel.end) || offset > Math.max(sel.start, sel.end)) {
      this.clearSelection()
      this.setCursor(row, clampedCol)
    }
    const cb = this.onContextMenu
    if (cb) queueMicrotask(() => cb(event))
  }

  /** File position of a click, with the column clamped to the end of its line. */
  private clickPos(event: MouseEvent): { row: number; col: number } {
    const { row, col } = this.posAtScreen(event.x, event.y)
    const lineText = this.lineText(row)
    return { row, col: Math.min(col, Bun.stringWidth(lineText)) }
  }

  override handleKeyPress(key: KeyEvent): boolean {
    // Typing never waits for a scroll animation: a key ends it where it is.
    this.stopGlide()
    return this.editorKey(key) || super.handleKeyPress(key)
  }

  private editorKey(key: KeyEvent): boolean {
    const { name, ctrl, shift } = key
    const alt = key.meta || key.option
    if (!alt && !key.super) {
      if (name === "home") return ctrl ? this.fileEdge(-1, shift) : this.smartHome(shift)
      if (name === "end") return ctrl ? this.fileEdge(1, shift) : this.lineEnd(shift)
      if (ctrl && shift && name === "left") return this.moveWordBackward({ select: true })
      if (ctrl && shift && name === "right") return this.moveWordForward({ select: true })
      if (!ctrl && (name === "pageup" || name === "pagedown")) return this.page(name === "pageup" ? -1 : 1, shift)
    }
    if (ctrl || alt || key.super) return false
    if (name === "escape" && this.hasSelection()) {
      this.clearSelection()
      return true
    }
    // Legacy terminals send Ctrl+Backspace as ^H and Backspace as DEL; both parse as "backspace".
    if (name === "backspace" && key.sequence === "\b") return this.deleteWordBackward()
    if (name === "return" || name === "kpenter") return this.autoIndent && this.enter()
    if (name === "backspace") return this.autoClosingBrackets && this.backspacePair()
    const ch = key.sequence
    if (this.autoClosingBrackets && ch?.length === 1 && isTypingPairChar(ch)) return this.typePairChar(ch)
    return false
  }

  /** One line's text, without copying the whole document out of the native buffer. */
  lineText(row: number): string {
    return this.lineRange(row, row)[0] ?? ""
  }

  /** Lines from..to (inclusive, clamped to the file), read without copying the whole document. */
  lineRange(from: number, to: number): string[] {
    from = Math.max(0, from)
    to = Math.min(to, this.lineCount - 1)
    if (to < from) return []
    const eb = this.editBuffer
    const start = eb.getLineStartOffset(from)
    const last = to + 1 >= this.lineCount
    const text = this.textRange(start, last ? Number.MAX_SAFE_INTEGER : eb.getLineStartOffset(to + 1))
    return (last ? text : text.slice(0, -1)).split("\n")
  }

  /** The cursor's line, with the cursor as a string index into it. */
  private cursorLine(): { row: number; col: number; line: string; index: number } {
    const { row, col } = this.editBuffer.getCursorPosition()
    const eol = this.editBuffer.getEOL()
    const line = this.getTextRangeByCoords(row, 0, row, eol.col)
    return { row, col, line, index: colToIndex(line, col) }
  }

  private smartHome(select: boolean): boolean {
    this.updateSelectionForMovement(select, true)
    const { row, line, index } = this.cursorLine()
    this.editBuffer.setCursor(row, indexToCol(line, homeIndex(line, index)))
    this.updateSelectionForMovement(select, false)
    this.requestRender()
    return true
  }

  /** End stays on the line (the native one wraps to the next line when already at the end). */
  private lineEnd(select: boolean): boolean {
    this.updateSelectionForMovement(select, true)
    const eol = this.editBuffer.getEOL()
    this.editBuffer.setCursor(eol.row, eol.col)
    this.updateSelectionForMovement(select, false)
    this.requestRender()
    return true
  }

  /** Ctrl+Home/End. The native ones only drop a selection on the first press. */
  private fileEdge(dir: -1 | 1, select: boolean): boolean {
    if (!select) this.clearSelection()
    return dir < 0 ? this.gotoBufferHome({ select }) : this.gotoBufferEnd({ select })
  }

  /** PageUp/PageDown: move the cursor a screen and scroll with it, so it keeps its place on screen. */
  private page(dir: -1 | 1, select: boolean): boolean {
    const n = Math.max(1, this.editorView.getViewport().height - 1)
    // Smoothly, the cursor and the view travel together a few lines per frame (the native view
    // would snap back to a cursor left off screen, so they can't move separately).
    if (this.smoothScroll) this.glideBy(dir * n, (k) => this.pageBy(k, select))
    else this.pageBy(dir * n, select)
    return true
  }

  /** Move the cursor `k` lines and the view with it. */
  private pageBy(k: number, select: boolean): void {
    const view = this.editorView
    const vp = view.getViewport()
    for (let i = 0; i < Math.abs(k); i++) {
      if (k < 0) this.moveCursorUp({ select })
      else this.moveCursorDown({ select })
    }
    const maxY = Math.max(0, view.getTotalVirtualLineCount() - vp.height)
    view.setViewport(vp.offsetX, Math.max(0, Math.min(maxY, vp.offsetY + k)), vp.width, vp.height, false)
    this.requestRender()
  }

  // ---- smooth scrolling ----

  private glider = new Glide()
  /** Glide scrolls instead of jumping (editor.smoothScrolling). */
  get smoothScroll(): boolean {
    return this.glider.enabled
  }
  set smoothScroll(on: boolean) {
    this.glider.enabled = on
  }

  private glideBy(total: number, move: (k: number) => void): void {
    this.glider.by(total, (k) => (this.isDestroyed ? this.glider.stop() : move(k)))
  }

  /** End a scroll animation where it is. */
  stopGlide(): void {
    this.glider.stop()
  }

  private enter(): boolean {
    if (this.hasSelection()) this.deleteCharBackward()
    const { row, line, index } = this.cursorLine()
    const unit = () => {
      const lines = this.textRange(0, 200_000).split("\n") // the start of the file is enough to guess
      return indentString(lines, indentUnit(lines))
    }
    const { text, caret } = enterText(line, index, unit)
    this.insertText(text)
    if (caret < text.length) {
      const before = text.slice(0, caret).split("\n")
      this.setCursor(row + before.length - 1, Bun.stringWidth(before.at(-1)!))
    }
    return true
  }

  private backspacePair(): boolean {
    if (this.hasSelection()) return false
    const { row, col, line, index } = this.cursorLine()
    if (!deletesPair(line, index)) return false
    this.deleteRange(row, col - 1, row, col + 1)
    this.setCursor(row, col - 1)
    return true
  }

  private typePairChar(ch: string): boolean {
    const close = PAIRS[ch]
    if (this.hasSelection()) {
      if (!close) return false
      // Typing a bracket or quote over a selection wraps it, keeping the text selected.
      const sel = this.getSelection()!
      const text = this.getSelectedText()
      const start = Math.min(sel.start, sel.end) + 1
      this.insertText(ch + text + close)
      const end = this.editBuffer.offsetToPosition(start + text.length)
      if (end) this.setCursor(end.row, end.col)
      this.setSelection(start, start + text.length)
      this.requestRender()
      return true
    }
    const { line, index } = this.cursorLine()
    const act = typeChar(ch, line, index)
    if (act === "over") return this.moveCursorRight()
    if (act !== "pair") return false
    this.insertText(ch + close)
    return this.moveCursorLeft()
  }

  /** Scroll so `row` is visible, centring it when it was off screen (no wrapping in this editor). */
  revealLine(row: number, col = 0): void {
    const view = this.editorView
    const vp = view.getViewport()
    let { offsetX: x, offsetY: y } = vp
    const visual = this.visualRowOf(row)
    if (visual < y || visual >= y + vp.height) y = Math.max(0, visual - Math.floor(vp.height / 3))
    if (!this.wraps && (col < x || col >= x + vp.width)) x = Math.max(0, col - Math.floor(vp.width / 2))
    if (x !== vp.offsetX || y !== vp.offsetY) {
      view.setViewport(x, y, vp.width, vp.height, false)
      this.requestRender()
    }
  }

  /** Move the cursor to (row, col) and bring it into view. */
  goTo(row: number, col: number): void {
    this.unpark()
    this.clearSelection()
    this.setCursor(row, col)
    this.revealLine(row, col)
  }

  /** Select columns startCol..endCol of `row` with the cursor at the end, and reveal it. */
  selectRange(row: number, startCol: number, endCol: number): void {
    this.unpark()
    const eb = this.editBuffer
    this.setCursor(row, endCol)
    this.setSelection(eb.positionToOffset(row, startCol), eb.positionToOffset(row, endCol))
    this.revealLine(row, startCol)
    this.requestRender()
  }

  /** Screen cell of the cursor (for popups), or null when it is scrolled out of view. */
  cursorScreenPos(): { x: number; y: number } | null {
    const vp = this.editorView.getViewport()
    const c = this.editorView.getVisualCursor()
    const x = c.visualCol - vp.offsetX
    const y = c.visualRow - vp.offsetY
    if (x < 0 || y < 0 || x > vp.width || y >= vp.height) return null
    return { x: this.x + x, y: this.y + y }
  }

  /** Screen row of a file line, or null when it is scrolled out of view. */
  rowScreenY(row: number): number | null {
    const vp = this.editorView.getViewport()
    const y = this.visualRowOf(row) - vp.offsetY
    return y < 0 || y >= vp.height ? null : this.y + y
  }

  /** Replace columns startCol..endCol of `row` with text, leaving the cursor after it. */
  replaceRange(row: number, startCol: number, endCol: number, text: string): void {
    this.unpark()
    this.clearSelection()
    if (endCol > startCol) this.deleteRange(row, startCol, row, endCol)
    this.setCursor(row, startCol)
    this.insertText(text)
  }

  private get wraps(): boolean {
    return this.wrapMode !== "none"
  }

  /** First screen (visual) row of a file line; the same number unless lines wrap. */
  visualRowOf(row: number): number {
    if (!this.wraps) return row
    const i = this.lineInfo.lineSources.indexOf(row)
    return i === -1 ? row : i
  }

  /** File line and column under a screen cell (handles wrapped lines). */
  posAtScreen(screenX: number, screenY: number): { row: number; col: number } {
    const vp = this.editorView.getViewport()
    const visual = Math.max(0, Math.floor(vp.offsetY + (screenY - this.y)))
    if (!this.wraps) {
      const row = Math.max(0, Math.min(this.lineCount - 1, visual))
      return { row, col: Math.max(0, Math.floor(vp.offsetX + (screenX - this.x))) }
    }
    const info = this.lineInfo
    const v = Math.min(visual, info.lineSources.length - 1)
    const row = info.lineSources[v] ?? this.lineCount - 1
    return { row, col: (info.lineStartCols[v] ?? 0) + Math.max(0, screenX - this.x) }
  }

  /** File line under a screen row. */
  lineAtScreenY(screenY: number): number {
    return this.posAtScreen(this.x, screenY).row
  }

  /**
   * Select whole lines a..b (inclusive, any order), including the trailing newline when there
   * is one. The cursor goes to the end the drag is at (b), like VS Code.
   */
  selectLines(a: number, b: number): void {
    const first = Math.max(0, Math.min(a, b))
    const last = Math.min(this.lineCount - 1, Math.max(a, b))
    const eb = this.editBuffer
    const start = eb.getLineStartOffset(first)
    let end: number
    let endPos: { row: number; col: number }
    if (last + 1 < this.lineCount) {
      end = eb.getLineStartOffset(last + 1)
      endPos = { row: last + 1, col: 0 }
    } else {
      const text = this.plainText
      const col = Bun.stringWidth(text.slice(text.lastIndexOf("\n") + 1))
      end = eb.positionToOffset(last, col)
      endPos = { row: last, col }
    }
    const forward = b >= a
    const cursor = forward ? endPos : { row: first, col: 0 }
    this.setCursor(cursor.row, cursor.col)
    this.setSelection(forward ? start : end, forward ? end : start)
    this.requestRender()
  }

  private scrollView(event: MouseEvent): void {
    if (!event.scroll) return
    const { direction, delta } = event.scroll
    // Shift+wheel scrolls horizontally, like most editors.
    const dir = event.modifiers.shift ? ({ up: "left", down: "right", left: "up", right: "down" } as const)[direction] : direction
    const vertical = dir === "up" || dir === "down"
    const amount = dir === "up" || dir === "left" ? -delta : delta
    // Vertical wheel steps glide; sideways ones are rare and stay instant.
    if (this.smoothScroll && vertical) this.glideBy(amount, (k) => this.scrollViewBy(0, k))
    else this.scrollViewBy(vertical ? 0 : amount, vertical ? amount : 0)
  }

  /** Scroll the view (not the cursor) by dx columns and dy lines, parking the cursor as needed. */
  private scrollViewBy(dx: number, dy: number): void {
    const view = this.editorView
    const vp = view.getViewport()
    const maxY = Math.max(0, view.getTotalVirtualLineCount() - vp.height)
    const x = Math.max(0, vp.offsetX + dx)
    const y = Math.max(0, Math.min(maxY, vp.offsetY + dy))
    if (x === vp.offsetX && y === vp.offsetY) return this.stopGlide() // reached the top or bottom
    // With a selection the native cursor is its active end; let it ride as the native view wants.
    if (this.hasSelection()) {
      view.setViewport(x, y, vp.width, vp.height, true)
      this.requestRender()
      return
    }
    const before = this.logicalCursor
    view.setViewport(x, y, vp.width, vp.height, true)
    const now = super.logicalCursor
    if (!this.parked && (now.row !== before.row || now.col !== before.col)) {
      this.parked = { row: before.row, col: before.col }
      this.showCursor = false
    } else if (this.parked) {
      // Scrolled back far enough that the native view would leave the real cursor alone.
      const margin = Math.max(1, Math.floor(vp.height * 0.2))
      const { row, col } = this.parked
      if (row >= y + margin && row < y + vp.height - margin) this.unpark()
      else if (row === now.row && col === now.col) this.dropPark()
    }
    this.requestRender()
  }
}

extend({ "code-editor": CodeEditorRenderable })

declare module "@opentui/react" {
  interface OpenTUIComponents {
    "code-editor": typeof CodeEditorRenderable
  }
}
