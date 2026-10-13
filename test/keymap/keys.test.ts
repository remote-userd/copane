import { expect, test } from "bun:test"
import { parseKeypress } from "@opentui/core"
import { buildBindings } from "../../src/keymap/bindings"
import { keyToString } from "../../src/keymap/keys"
import type { CommandId } from "../../src/keymap/commands"

// Raw bytes a legacy terminal (Windows Terminal, xterm) sends for each key.
const LEGACY: [string, string, CommandId][] = [
  ["Ctrl+/", "\x1f", "edit.toggleComment"],
  ["Alt+↑", "\x1b[1;3A", "edit.moveLineUp"],
  ["Alt+↓", "\x1b[1;3B", "edit.moveLineDown"],
  ["Shift+Alt+↑", "\x1b[1;4A", "edit.duplicateLineUp"],
  ["Shift+Alt+↓", "\x1b[1;4B", "edit.duplicateLineDown"],
  ["Ctrl+Alt+↑", "\x1b[1;7A", "edit.duplicateLineUp"],
  ["Ctrl+Alt+↓", "\x1b[1;7B", "edit.duplicateLineDown"],
  ["Alt+Shift+K", "\x1bK", "edit.deleteLine"],
  ["Tab", "\t", "edit.indent"],
  ["Shift+Tab", "\x1b[Z", "edit.outdent"],
  ["Ctrl+]", "\x1d", "edit.indentLine"],
  ["Alt+F5", "\x1b[15;3~", "git.nextChange"],
  ["Shift+Alt+F5", "\x1b[15;4~", "git.prevChange"],
  ["Shift+Alt+F (ESC F, parsed as Alt+→)", "\x1bF", "lsp.format"],
  ["Alt+. (ESC ., left unnamed by the parser)", "\x1b.", "lsp.quickFix"],
  ["Ctrl+. (CSI-u)", "\x1b[46;5u", "lsp.quickFix"],
  ["Shift+Alt+O (ESC O)", "\x1bO", "lsp.organizeImports"],
  ["Shift+Alt+R (ESC R)", "\x1bR", "file.revealInOS"],
  ["Alt+B (ESC b)", "\x1bb", "git.toggleFileBlame"],
]

const GLOBAL: [string, string, CommandId][] = [
  ["Alt+1", "\x1b1", "buffer.goto1"],
  ["Alt+←", "\x1b[1;3D", "nav.back"],
  ["Alt+→", "\x1b[1;3C", "nav.forward"],
  ["Alt+9", "\x1b9", "buffer.goto9"],
  ["Ctrl+Alt+T", "\x1b\x14", "buffer.reopenClosed"],
  ["Ctrl+T", "\x14", "file.symbolInProject"],
  ["Ctrl+Shift+O (sent as Ctrl+O)", "\x0f", "file.symbolInFile"],
  ["Alt+Shift+V (ESC V)", "\x1bV", "markdown.openPreview"],
  ["Ctrl+Alt+Z (ESC Ctrl+Z)", "\x1b\x1a", "ai.turns"],
  ["Ctrl+Alt+N (ESC Ctrl+N)", "\x1b\x0e", "ai.newAgent"],
  ["Ctrl+Alt+PageDown", "\x1b[6;7~", "ai.nextAgent"],
  ["Ctrl+Alt+PageUp", "\x1b[5;7~", "ai.prevAgent"],
  ["Alt+N (ESC n)", "\x1bn", "ai.nextChange"],
  ["Alt+P (ESC p)", "\x1bp", "ai.prevChange"],
  ["Alt+` (ESC `)", "\x1b`", "ai.newTerminal"],
]

test.each(GLOBAL)("%s reaches its global command", (_name, bytes, command) => {
  expect(buildBindings().global.get(keyToString(parseKeypress(bytes)!))).toBe(command)
})

test("Ctrl+Alt+V starts reviewing AI changes, from the AI pane too", () => {
  const key = keyToString(parseKeypress("\x1b\x16")!)
  expect(buildBindings().global.get(key)).toBe("ai.nextChange")
  expect(buildBindings().ai.get(key)).toBe("ai.nextChange")
})

test("Alt+N / Alt+P stay with the CLI in the AI pane", () => {
  for (const bytes of ["\x1bn", "\x1bp"]) expect(buildBindings().ai.get(keyToString(parseKeypress(bytes)!))).toBeUndefined()
})

test("Ctrl+Alt+W closes the agent tab, only from the AI pane", () => {
  const key = keyToString(parseKeypress("\x1b\x17")!)
  expect(buildBindings().ai.get(key)).toBe("ai.closeAgent")
  expect(buildBindings().global.get(key)).toBeUndefined()
})

test("chords: Ctrl+K then a second key", () => {
  const b = buildBindings({ editor: { "Ctrl+K Ctrl+W": "buffer.close" } })
  const k = keyToString(parseKeypress("\x0b")!)
  const c = keyToString(parseKeypress("\x03")!)
  expect(b.editor.get(`${k} ${c}`)).toBe("edit.addComment")
  expect(b.editor.get("ctrl+k ctrl+w")).toBe("buffer.close")
  expect(b.global.get("ctrl+k z")).toBe("view.maximizeEditor")
  expect(b.global.get(`${k} ${keyToString(parseKeypress("v")!)}`)).toBe("markdown.togglePreviewSide")
  expect(b.global.get(`${k} ${keyToString(parseKeypress("f")!)}`)).toBe("ai.fixProblems")
  expect(b.global.get(`${k} ${keyToString(parseKeypress("d")!)}`)).toBe("ai.reviewChanges")
  expect(b.global.get(`${k} ${keyToString(parseKeypress("e")!)}`)).toBe("ai.fixTerminalError")
})

test.each(LEGACY)("%s reaches its editor command", (_name, bytes, command) => {
  const key = parseKeypress(bytes)!
  expect(buildBindings().editor.get(keyToString(key))).toBe(command)
})

test("plain capital letters still type (Shift+K is not Alt+Shift+K)", () => {
  expect(keyToString(parseKeypress("K")!)).toBe("shift+k")
  expect(buildBindings().editor.get("shift+k")).toBeUndefined()
})
