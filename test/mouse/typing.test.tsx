import { afterEach, expect, test } from "bun:test"
import type { CodeEditorRenderable } from "../../src/editor/CodeEditorRenderable"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})

async function open(text: string) {
  const root = await fixture({ "a.ts": text })
  const ws = createWorkspace(root)
  await ws.buffers.open("a.ts")
  h = await renderApp(ws, { tree: <text>TREE</text> })
  return h
}

const text = (h: Harness) => h.ws.buffers.active!.textarea!.plainText

test("Enter keeps the indent and splits a bracket pair; typing pairs brackets", async () => {
  const h = await open("function f() {\n  if (x) {}\n}\n")
  const ta = h.ws.buffers.active!.textarea!
  ta.setCursor(1, 10)
  await h.step(() => h.keys.pressEnter())
  expect(text(h)).toBe("function f() {\n  if (x) {\n    \n  }\n}\n")
  expect(ta.logicalCursor).toMatchObject({ row: 2, col: 4 })
  expect(h.ws.buffers.active!.dirty).toBe(true)
  await h.step(() => h.keys.typeText("g("))
  expect(text(h).split("\n")[2]).toBe("    g()")
  await h.step(() => h.keys.typeText(")"))
  expect(text(h).split("\n")[2]).toBe("    g()")
  expect(ta.logicalCursor).toMatchObject({ row: 2, col: 7 })
  await h.step(() => h.keys.typeText('["'))
  expect(text(h).split("\n")[2]).toBe('    g()[""]')
  // Terminals send DEL for Backspace (the test helper's pressBackspace sends ^H, Ctrl+Backspace).
  await h.step(() => h.keys.pressKey("\x7f"))
  expect(text(h).split("\n")[2]).toBe("    g()[]")
})

test("Ctrl+Backspace (^H in legacy terminals) deletes a word", async () => {
  const h = await open("const value = something\n")
  const ta = h.ws.buffers.active!.textarea!
  ta.setCursor(0, 23)
  await h.step(() => h.keys.pressKey("\b"))
  expect(text(h)).toBe("const value = \n")
  await h.step(() => h.keys.pressKey("\x7f"))
  expect(text(h)).toBe("const value =\n")
})

test("a bracket typed over a selection wraps it", async () => {
  const h = await open("const v = a + b\n")
  const ta = h.ws.buffers.active!.textarea as CodeEditorRenderable
  ta.selectRange(0, 10, 15)
  await h.step(() => h.keys.typeText("("))
  expect(text(h)).toBe("const v = (a + b)\n")
  expect(ta.getSelectedText()).toBe("a + b")
  await h.step(() => h.keys.pressEscape())
  await Bun.sleep(100)
  expect(ta.hasSelection()).toBe(false)
})

test("Home goes to the first character then column 0; End stays on the line; Ctrl+Home/End", async () => {
  const h = await open("a\n    foo()\nb\n")
  const ta = h.ws.buffers.active!.textarea!
  ta.setCursor(1, 7)
  await h.step(() => h.keys.pressKey("HOME"))
  expect(ta.logicalCursor).toMatchObject({ row: 1, col: 4 })
  await h.step(() => h.keys.pressKey("HOME"))
  expect(ta.logicalCursor).toMatchObject({ row: 1, col: 0 })
  await h.step(() => h.keys.pressKey("END"))
  await h.step(() => h.keys.pressKey("END"))
  expect(ta.logicalCursor).toMatchObject({ row: 1, col: 9 })
  await h.step(() => h.keys.pressKey("\x1b[1;2H"))
  expect(ta.getSelectedText()).toBe("foo()")
  await h.step(() => h.keys.pressKey("\x1b[1;5F"))
  expect(ta.logicalCursor.row).toBe(3)
  await h.step(() => h.keys.pressKey("\x1b[1;5H"))
  expect(ta.logicalCursor).toMatchObject({ row: 0, col: 0 })
})

test("PageDown/PageUp move the cursor a screen", async () => {
  const h = await open(Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n"))
  const ta = h.ws.buffers.active!.textarea!
  ta.setCursor(0, 0)
  await h.step(() => h.keys.pressKey("\x1b[6~"))
  const row = ta.logicalCursor.row
  expect(row).toBeGreaterThan(5)
  await h.step(() => h.keys.pressKey("\x1b[5~"))
  expect(ta.logicalCursor.row).toBe(0)
})
