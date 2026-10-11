import type { Workspace } from "../app/workspace"
import { sendProblems } from "../ai/askAi"
import { lineAt, type CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import { openAt, recordJump } from "../app/navHistory"
import { findPrettier, prettierHandles, runPrettier } from "../editor/prettier"
import type { CodeAction, Diagnostic, Range } from "./LspManager"
import { applyTextEdits, type TextEdit } from "./edits"
import { applyToFiles } from "../app/fileEdits"
import { colToIndex, indexToCol } from "./positions"

const editorOf = (ws: Workspace) => (ws.buffers.active?.textarea ?? null) as CodeEditorRenderable | null

function here(ws: Workspace) {
  const ed = editorOf(ws)
  const buf = ws.buffers.active
  if (!ed || !buf) return null
  const { row, col } = ed.logicalCursor
  const line = lineAt(ed, row)
  return { ed, buf, row, col, line, pos: { line: row, character: colToIndex(line, col) } }
}

const severityName = (s: number | undefined) => (s === 2 ? "warning" : s === 3 ? "info" : s === 4 ? "hint" : "error")

export function describeDiagnostic(d: Diagnostic): string {
  return `${severityName(d.severity)}: ${d.message}${d.code !== undefined ? ` (${d.source ?? ""}${d.source ? " " : ""}${d.code})` : ""}`
}

/** Diagnostics touching the cursor's line, most severe first. */
export function diagnosticsAtCursor(ws: Workspace): Diagnostic[] {
  const ed = editorOf(ws)
  const buf = ws.buffers.active
  if (!ed || !buf || !ws.lsp) return []
  const { row } = ed.logicalCursor
  return ws.lsp
    .diagnostics(buf.path)
    .filter((d) => d.range.start.line <= row && row <= d.range.end.line)
    .sort((a, b) => (a.severity ?? 1) - (b.severity ?? 1))
}

/** Ctrl+Alt+I: type info and docs for the symbol under the cursor, plus problems on this line. */
export async function showHover(ws: Workspace): Promise<void> {
  const h = here(ws)
  if (!h) return ws.notify("No file open", "warn")
  if (!ws.lsp?.hasServer(h.buf.path)) return ws.notify("No language server for this file", "warn")
  const info = await ws.lsp.hover(h.buf.path, h.pos)
  const problems = diagnosticsAtCursor(ws).map(describeDiagnostic)
  const text = [...problems, info ?? ""].filter(Boolean).join("\n\n")
  if (!text) return ws.notify("Nothing to show here")
  const at = h.ed.cursorScreenPos() ?? { x: h.ed.x, y: h.ed.y }
  ws.ui.set({ modal: { kind: "info", x: at.x, y: at.y, text } })
}

/** F12: jump to where the symbol under the cursor (or at a Ctrl+clicked spot) is defined. */
export async function goToDefinition(ws: Workspace, at?: { row: number; col: number }): Promise<void> {
  if (at) {
    // Remember where we were before the click moves the cursor, so Back returns there.
    recordJump(ws)
    const ed = editorOf(ws)
    ed?.goTo(at.row, at.col)
    if (ws.buffers.active) ws.buffers.onCursorChange(ws.buffers.active.id)
  }
  const h = here(ws)
  if (!h) return ws.notify("No file open", "warn")
  if (!ws.lsp?.hasServer(h.buf.path)) return ws.notify("No language server for this file", "warn")
  const loc = await ws.lsp.definition(h.buf.path, h.pos)
  if (!loc) return ws.notify("No definition found")
  const lineText = async () => {
    const open = ws.buffers.byPath(loc.path)
    const text = open ? ws.buffers.textOf(open) : await Bun.file(loc.path).text().catch(() => "")
    return text.split("\n")[loc.range.start.line] ?? ""
  }
  const line = await lineText()
  const start = indexToCol(line, loc.range.start.character)
  const end = loc.range.end.line === loc.range.start.line ? indexToCol(line, loc.range.end.character) : start
  await openAt(ws, loc.path, loc.range.start.line, start, end, { record: !at })
}

/** F8: the next problem in this file after the cursor (wrapping), with its message. */
export async function nextProblem(ws: Workspace): Promise<void> {
  const h = here(ws)
  if (!h || !ws.lsp) return
  const diags = [...ws.lsp.diagnostics(h.buf.path)].sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character)
  if (!diags.length) return ws.notify("No problems in this file")
  const idx = colToIndex(h.line, h.col)
  const next =
    diags.find((d) => d.range.start.line > h.row || (d.range.start.line === h.row && d.range.start.character > idx)) ?? diags[0]!
  const line = lineAt(h.ed, next.range.start.line)
  const start = indexToCol(line, next.range.start.character)
  const end = next.range.end.line === next.range.start.line ? indexToCol(line, next.range.end.character) : start
  h.ed.selectRange(next.range.start.line, start, Math.max(end, start))
  ws.buffers.onCursorChange(h.buf.id)
  ws.notify(describeDiagnostic(next), next.severity === 1 || next.severity === undefined ? "error" : "warn")
}

/** Open buffers' versions, taken before asking the server for edits (see applyFileEdits). */
export function openVersions(ws: Workspace): Map<string, number> {
  return new Map(ws.buffers.list().map((b) => [b.path, b.version]))
}

/**
 * Apply LSP edits per file path (see applyToFiles). With `since` (versions from before the
 * request), an open file that changed meanwhile is skipped: the edits' positions are for the
 * old text and would garble the new one. Skipped files are reported.
 */
export async function applyFileEdits(ws: Workspace, files: Map<string, TextEdit[]>, since?: Map<string, number>): Promise<number> {
  const stale: string[] = []
  const apply = new Map<string, (text: string) => string>()
  for (const [path, edits] of files) {
    if (!edits.length) continue
    const buf = ws.buffers.byPath(path)
    const before = since?.get(path)
    if (buf && before !== undefined && buf.version !== before) {
      stale.push(buf.relPath)
      continue
    }
    apply.set(path, (text: string) => applyTextEdits(text, edits))
  }
  if (stale.length) ws.notify(`Not changed, edited while the language server worked: ${stale.join(", ")} (try again)`, "warn")
  return applyToFiles(ws, apply)
}

/** F2 in the editor: rename the symbol under the cursor everywhere it is used. */
export function renameSymbol(ws: Workspace): void {
  const h = here(ws)
  if (!h) return ws.notify("No file open", "warn")
  if (!ws.lsp?.hasServer(h.buf.path)) return ws.notify("No language server for this file", "warn")
  const { word } = wordAt(h.line, h.pos.character)
  if (!word) return ws.notify("Put the cursor on a name to rename it")
  ws.ui.set({
    modal: {
      kind: "prompt",
      title: "Rename symbol",
      label: `New name for ${word} (all files)`,
      initial: word,
      submit: async (newName) => {
        const name = newName.trim()
        if (!name || name === word) return null
        const since = openVersions(ws)
        const files = await ws.lsp!.rename(h.buf.path, h.pos, name)
        if (typeof files === "string") return files
        ws.ui.set({ modal: null, focus: "editor" })
        const n = await applyFileEdits(ws, files, since)
        ws.notify(`Renamed ${word} → ${name} in ${n} file${n === 1 ? "" : "s"} (open files: Ctrl+Z undoes)`)
        return null
      },
    },
  })
}

/** Ctrl+Alt+L: format the file with the language server. */
/** Shift+Alt+F. `quiet` (format on save) reports only failures. */
export async function formatDocument(ws: Workspace, { quiet = false } = {}): Promise<void> {
  const notify: Workspace["notify"] = (text, kind) => (quiet && kind !== "error" ? undefined : ws.notify(text, kind))
  const h = here(ws)
  if (!h) return notify("No file open", "warn")
  const how = ws.config.editor.formatter
  // Projects that use Prettier get Prettier, as with VS Code's Prettier extension.
  const prettier = how !== "lsp" && prettierHandles(h.buf.path) ? await findPrettier(h.buf.path, ws.root) : null
  if (prettier) return formatWith(ws, notify, h, "Prettier", async (text) => runPrettier(prettier, h.buf.path, text, ws.root))
  if (how === "prettier") return notify("Prettier not found for this file", "warn")
  if (!ws.lsp?.hasServer(h.buf.path)) return notify("No language server or Prettier for this file", "warn")
  const lsp = ws.lsp
  // The server's edits are for the text as sent now: read it before asking, not after.
  const before = h.ed.plainText
  const edits = await lsp.format(h.buf.path)
  if (edits === null) return notify("This language server cannot format", "warn")
  return formatWith(ws, notify, h, "", async (text) => applyTextEdits(text, edits), before)
}

async function formatWith(
  ws: Workspace,
  notify: Workspace["notify"],
  h: NonNullable<ReturnType<typeof here>>,
  by: string,
  format: (text: string) => Promise<string>,
  before = h.ed.plainText,
) {
  let after: string
  try {
    after = (await format(before)).replace(/\r\n/g, "\n")
  } catch (err) {
    return notify(`${by || "Format"}: ${(err as Error).message}`, "error")
  }
  // The text may have changed while the formatter ran; don't overwrite those edits.
  if (h.ed.isDestroyed || h.ed.plainText !== before) return
  if (after === before) return notify("Already formatted")
  const { row, col } = h.ed.logicalCursor
  ws.buffers.replaceText(h.buf, after)
  h.ed.goTo(Math.min(row, h.ed.lineCount - 1), col)
  notify(`Formatted${by ? ` with ${by}` : ""} (Ctrl+Z undoes)`)
}

/** Shift+F12: every use of the symbol under the cursor. */
export async function findReferences(ws: Workspace): Promise<void> {
  const h = here(ws)
  if (!h) return ws.notify("No file open", "warn")
  if (!ws.lsp?.hasServer(h.buf.path)) return ws.notify("No language server for this file", "warn")
  const refs = await ws.lsp.references(h.buf.path, h.pos)
  if (!refs.length) return ws.notify("No references found")
  const { word } = wordAt(h.line, h.pos.character)
  ws.ui.set({ modal: { kind: "locations", title: `References to ${word || "symbol"} (${refs.length})`, locations: refs } })
}

function wordAt(line: string, index: number): { start: number; word: string } {
  let start = index
  let end = index
  while (start > 0 && /[\w$]/.test(line[start - 1]!)) start--
  while (end < line.length && /[\w$]/.test(line[end]!)) end++
  return { start, word: line.slice(start, end) }
}

/** The selection (or the cursor) as an LSP range. */
function selectionRange(h: NonNullable<ReturnType<typeof here>>): Range {
  const lines = h.ed.plainText.split("\n")
  const at = (p: { row: number; col: number }) => ({ line: p.row, character: colToIndex(lines[p.row] ?? "", p.col) })
  const s = h.ed.hasSelection() ? h.ed.getSelection() : null
  const a = s && h.ed.editBuffer.offsetToPosition(Math.min(s.start, s.end))
  const b = s && h.ed.editBuffer.offsetToPosition(Math.max(s.start, s.end))
  return a && b ? { start: at(a), end: at(b) } : { start: h.pos, end: h.pos }
}

/** Apply a code action: its edit, then its command (whose edits come back through workspace/applyEdit). */
async function runCodeAction(ws: Workspace, path: string, action: CodeAction, since: Map<string, number>): Promise<void> {
  const lsp = ws.lsp!
  const resolved = await lsp.resolveCodeAction(path, action)
  if (resolved.edit) await applyFileEdits(ws, lsp.editFiles(resolved.edit), since)
  // A bare Command has its name in `command`; a CodeAction has a Command object there.
  const command = typeof resolved.command === "string" ? { command: resolved.command, arguments: resolved.arguments } : resolved.command
  if (command) {
    const err = await lsp.executeCommand(path, command)
    if (err) return ws.notify(`${resolved.title}: ${err}`, "error")
  }
  ws.notify(`${resolved.title} (Ctrl+Z undoes)`)
}

const kindOrder = (a: CodeAction) => (a.isPreferred ? 0 : a.kind?.startsWith("quickfix") ? 1 : a.kind?.startsWith("refactor") ? 2 : 3)

/** Ctrl+. / Alt+.: quick fixes and refactors at the cursor, in a menu. */
export async function quickFix(ws: Workspace): Promise<void> {
  const h = here(ws)
  if (!h) return ws.notify("No file open", "warn")
  if (!ws.lsp?.hasServer(h.buf.path)) return ws.notify("No language server for this file", "warn")
  // The actions' edits are for the text as it is now: one picked after more typing is skipped.
  const since = openVersions(ws)
  const actions = (await ws.lsp.codeActions(h.buf.path, selectionRange(h))).sort((a, b) => kindOrder(a) - kindOrder(b))
  const row = h.pos.line
  // A problem on this line can also go to the AI, even when the server has no fix for it.
  const problemHere = ws.lsp.diagnostics(h.buf.path).some((d) => (d.severity ?? 1) <= 2 && d.range.start.line <= row && d.range.end.line >= row)
  const askAi = problemHere && ws.ai ? [{ label: "Ask AI to fix", hint: "AI", run: () => sendProblems(ws, { at: { path: h.buf.path, line: row } }) }] : []
  if (!actions.length && !askAi.length) return ws.notify("No quick fixes here")
  const at = h.ed.cursorScreenPos() ?? { x: h.ed.x, y: h.ed.y }
  ws.ui.set({
    modal: {
      kind: "menu",
      x: at.x,
      y: at.y + 1,
      items: [
        ...actions.map((a) => ({
          label: a.title,
          hint: a.isPreferred ? "★" : (a.kind?.split(".")[0] ?? ""),
          run: () => {
            ws.ui.set({ modal: null, focus: "editor" })
            return runCodeAction(ws, h.buf.path, a, since)
          },
        })),
        ...askAi,
      ],
    },
  })
}

/** Shift+Alt+O: sort imports and drop unused ones. */
export async function organizeImports(ws: Workspace): Promise<void> {
  const h = here(ws)
  if (!h) return ws.notify("No file open", "warn")
  if (!ws.lsp?.hasServer(h.buf.path)) return ws.notify("No language server for this file", "warn")
  const zero = { line: 0, character: 0 }
  const since = openVersions(ws)
  const [action] = await ws.lsp.codeActions(h.buf.path, { start: zero, end: zero }, ["source.organizeImports"])
  if (!action) return ws.notify("Nothing to organize")
  await runCodeAction(ws, h.buf.path, action, since)
}
