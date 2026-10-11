import { afterEach, expect, test } from "bun:test"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})

const SRC = "const a = 1\nconst b = 2\nconst c = 3\n"

async function open(name = "a.ts", text = SRC) {
  const root = await fixture({ [name]: text })
  const ws = createWorkspace(root)
  await ws.buffers.open(name)
  h = await renderApp(ws, { tree: <text>TREE</text> })
  return h
}

const text = (h: Harness) => h.ws.buffers.active!.textarea!.plainText

test("Ctrl+/ comments the line and one Ctrl+Z undoes it", async () => {
  const h = await open()
  const ta = h.ws.buffers.active!.textarea!
  ta.setCursor(1, 6)
  await h.step(() => h.keys.pressKey("_", { ctrl: true }))
  expect(text(h)).toBe("const a = 1\n// const b = 2\nconst c = 3\n")
  expect(ta.logicalCursor).toMatchObject({ row: 1, col: 9 })
  expect(h.ws.buffers.active!.dirty).toBe(true)
  await h.step(() => h.keys.pressKey("z", { ctrl: true }))
  expect(text(h)).toBe(SRC)
})

test("Alt+↓ moves a line, Shift+Alt+↓ duplicates it, Alt+Shift+K deletes it (VS Code keys)", async () => {
  const h = await open()
  const ta = h.ws.buffers.active!.textarea!
  ta.setCursor(0, 2)
  await h.step(() => h.keys.pressArrow("down", { meta: true }))
  expect(text(h)).toBe("const b = 2\nconst a = 1\nconst c = 3\n")
  expect(ta.logicalCursor).toMatchObject({ row: 1, col: 2 })
  await h.step(() => h.keys.pressArrow("down", { meta: true, shift: true }))
  expect(text(h)).toBe("const b = 2\nconst a = 1\nconst a = 1\nconst c = 3\n")
  expect(ta.logicalCursor.row).toBe(2)
  await h.step(() => h.keys.pressKey("K", { meta: true }))
  expect(text(h)).toBe("const b = 2\nconst a = 1\nconst c = 3\n")
  await h.step(() => h.keys.pressKey("z", { ctrl: true }))
  expect(text(h)).toBe("const b = 2\nconst a = 1\nconst a = 1\nconst c = 3\n")
})

test("Tab indents a selection and Shift+Tab outdents it; Tab with no selection inserts spaces", async () => {
  const h = await open("a.py", "if x:\n    a\n    b\n    c\n")
  const ta = h.ws.buffers.active!.textarea!
  ta.setCursor(1, 0)
  ta.setSelection(ta.editBuffer.getLineStartOffset(1), ta.editBuffer.getLineStartOffset(3))
  await h.step(() => h.keys.pressTab())
  expect(text(h)).toBe("if x:\n        a\n        b\n    c\n")
  expect(ta.getSelectedText()).toBe("        a\n        b\n")
  await h.step(() => h.keys.pressTab({ shift: true }))
  expect(text(h)).toBe("if x:\n    a\n    b\n    c\n")
  ta.clearSelection()
  ta.setCursor(0, 1)
  await h.step(() => h.keys.pressTab())
  expect(text(h)).toBe("i   f x:\n    a\n    b\n    c\n")
})

test("toggle comment says so when the language has no line comments", async () => {
  const h = await open("a.html", "<p>hi</p>\n")
  await h.step(() => h.keys.pressKey("_", { ctrl: true }))
  expect(text(h)).toBe("<p>hi</p>\n")
  expect(h.lines().at(-2)).toContain("No line comments")
})
