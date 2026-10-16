import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"
import { SearchModal } from "../../src/files/SearchModal"
import { forgetLastSearch } from "../../src/files/SearchPanel"
import { TreeModel } from "../../src/files/TreeModel"
import { createWorkspace, fixture, numbered, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => {
  forgetLastSearch()
  h?.setup.renderer.destroy()
  h = null
})

async function app(files: Record<string, string>, open = "a.ts") {
  const root = await fixture(files)
  const ws = createWorkspace(root)
  const tree = new TreeModel(root)
  await ws.buffers.open(open)
  h = await renderApp(ws, { tree: <text>TREE</text>, search: <SearchModal tree={tree} /> })
  await settle()
  return { h, ws, root }
}
const settle = async (ms = 40) => {
  await Bun.sleep(ms)
  await h!.setup.renderOnce()
}
const ed = (ws: ReturnType<typeof createWorkspace>) => ws.buffers.active!.textarea!

test("Ctrl+F: typing jumps to the first match, Enter cycles, Esc closes and keeps the selection", async () => {
  const { h, ws } = await app({ "a.ts": "let total = 0\nfoo()\ntotal += 1\nreturn total\n" })
  await h.step(() => h.keys.pressKey("f", { ctrl: true }))
  expect(h.frame()).toContain("Find")
  await h.step(() => h.keys.typeText("total"))
  await settle()
  expect(h.frame()).toContain("1/3")
  expect(ed(ws).getSelectedText()).toBe("total")
  expect(ed(ws).logicalCursor.row).toBe(0)
  await h.step(() => h.keys.pressEnter())
  expect(h.frame()).toContain("2/3")
  expect(ed(ws).logicalCursor.row).toBe(2)
  // Shift+Enter is plain Enter in most terminals; ↑ always means "previous".
  await h.step(() => h.keys.pressArrow("up"))
  expect(h.frame()).toContain("1/3")
  await h.step(() => h.keys.pressEscape())
  await settle(150)
  expect(ws.ui.get().find).toBeNull()
  expect(ed(ws).getSelectedText()).toBe("total")
})

test("smart case and no-results state", async () => {
  const { h } = await app({ "a.ts": "Total total\n" })
  await h.step(() => h.keys.pressKey("f", { ctrl: true }))
  await h.step(() => h.keys.typeText("Total"))
  await settle()
  expect(h.frame()).toContain("1/1")
  await h.step(() => h.keys.typeText("x"))
  await settle()
  expect(h.frame()).toContain("no results")
})

test("Ctrl+F twice opens replace; Enter replaces one, Alt+Enter all; each is one undo step", async () => {
  const { h, ws } = await app({ "a.ts": "a foo b foo c foo\n" })
  await h.step(() => h.keys.pressKey("f", { ctrl: true }))
  await h.step(() => h.keys.typeText("foo"))
  await h.step(() => h.keys.pressKey("f", { ctrl: true }))
  expect(h.frame()).toContain("Replace")
  await h.step(() => h.keys.pressTab())
  await h.step(() => h.keys.typeText("bar"))
  await h.step(() => h.keys.pressEnter())
  await settle()
  expect(ed(ws).plainText).toBe("a bar b foo c foo\n")
  await h.step(() => h.keys.pressEnter({ meta: true }))
  await settle()
  expect(ed(ws).plainText).toBe("a bar b bar c bar\n")
  await h.step(() => h.keys.pressEscape())
  await settle(150)
  ed(ws).undo()
  expect(ed(ws).plainText).toBe("a bar b foo c foo\n")
})

test("Ctrl+G goes to line:column and scrolls there", async () => {
  const { h, ws } = await app({ "a.ts": numbered(200) })
  await h.step(() => h.keys.pressKey("g", { ctrl: true }))
  expect(h.frame()).toContain("Go to line")
  await h.step(() => h.keys.typeText("150:3"))
  await h.step(() => h.keys.pressEnter())
  await settle()
  expect(ed(ws).logicalCursor).toMatchObject({ row: 149, col: 2 })
  expect(h.frame()).toContain("line 150")
  expect(h.lines().at(-2)).toContain("Ln 150, Col 3")
})

test("search popup (narrow terminals) lists hits and Enter opens the file at the match", async () => {
  const { h, ws, root } = await app({ "a.ts": "x\n", "src/deep/b.ts": "\n\n  const needleValue = 1\n" })
  await h.step(() => ws.ui.set({ modal: { kind: "search" } }))
  expect(h.frame()).toContain("Search in files")
  await h.step(() => h.keys.typeText("needlev"))
  for (let i = 0; i < 30 && !h.frame().includes("b.ts"); i++) await settle(30)
  await h.step(() => h.keys.pressArrow("down")) // past the file's header row
  await h.step(() => h.keys.pressEnter())
  await settle(120)
  expect(ws.buffers.active?.path).toBe(join(root, "src/deep/b.ts"))
  expect(ed(ws).getSelectedText()).toBe("needleV") // exactly the match
  expect(ws.ui.get().modal).toBeNull()
})

test("search popup: the Replace all question returns to the popup, fields kept, on Escape or Cancel", async () => {
  const { h, ws } = await app({ "a.ts": "x\n", "b.ts": "const needle = 1\n" })
  await h.step(() => ws.ui.set({ modal: { kind: "search", replace: true } }))
  await h.step(() => h.keys.typeText("needle"))
  for (let i = 0; i < 30 && !h.frame().includes("b.ts"); i++) await settle(30)
  await h.step(() => h.keys.pressTab())
  await h.step(() => h.keys.typeText("pin"))
  const ask = async () => {
    // Back in the popup, its search runs again first: click once the results are in.
    for (let i = 0; i < 30 && ws.ui.get().modal?.kind !== "confirm"; i++) {
      const button = h.find("Replace all")
      await h.step(() => h.mouse.click(button.x + 1, button.y))
      await settle(60)
    }
    expect(h.frame()).toContain('"needle" → "pin"')
  }
  await ask()
  await h.step(() => h.keys.pressEscape())
  await settle()
  expect(ws.ui.get().modal?.kind).toBe("search")
  expect(h.frame()).toContain("needle")
  expect(h.frame()).toContain("pin")
  await ask()
  await h.step(() => h.keys.pressKey("n"))
  await settle()
  expect(ws.ui.get().modal?.kind).toBe("search")
})

test("F1 command palette: fuzzy search shows shortcuts; Enter runs the command", async () => {
  const { h, ws } = await app({ "a.ts": "x\n" })
  await h.step(() => h.keys.pressKey("F1"))
  expect(h.frame()).toContain("Commands")
  await h.step(() => h.keys.typeText("gotoline"))
  await settle()
  expect(h.frame()).toContain("Go to line[:column]")
  expect(h.frame()).toContain("Ctrl+G")
  await h.step(() => h.keys.pressEnter())
  await settle()
  expect(ws.ui.get().modal?.kind).toBe("prompt")
})

test("multi-cursor: Ctrl+D adds occurrences, typing edits all, Esc ends; Ctrl+Alt+A selects every one", async () => {
  const { h, ws } = await app({ "a.ts": "let item = 1\nuse(item, item)\nitems\n" })
  const ta = ed(ws)
  ta.setCursor(0, 5) // inside "item"
  await h.step(() => h.keys.pressKey("d", { ctrl: true }))
  expect(ta.getSelectedText()).toBe("item")
  await h.step(() => h.keys.pressKey("d", { ctrl: true }))
  await h.step(() => h.keys.pressKey("d", { ctrl: true }))
  expect(h.lines().at(-2)).toContain("3 cursors")
  await h.step(() => h.keys.typeText("count"))
  expect(ta.plainText).toBe("let count = 1\nuse(count, count)\nitems\n")
  await h.step(() => h.keys.pressBackspace())
  expect(ta.plainText).toBe("let coun = 1\nuse(coun, coun)\nitems\n")
  await h.step(() => h.keys.pressEscape())
  await settle(150)
  expect(h.lines().at(-2)).not.toContain("cursors")
  // The whole multi-cursor session is one undo step.
  ta.undo()
  expect(ta.plainText).toBe("let item = 1\nuse(item, item)\nitems\n")
  ta.redo()
  expect(ta.plainText).toBe("let coun = 1\nuse(coun, coun)\nitems\n")
  // Typing now only affects the single cursor.
  await h.step(() => h.keys.typeText("t"))
  expect(ta.plainText).toBe("let count = 1\nuse(coun, coun)\nitems\n")
  ta.undo()
  // Ctrl+Alt+A takes every whole-word occurrence of the word under the cursor.
  ta.setText("item\nitems item\n")
  ta.setCursor(0, 1)
  await h.step(() => h.keys.pressKey("a", { ctrl: true, meta: true }))
  expect(h.lines().at(-2)).toContain("2 cursors")
  await h.step(() => h.keys.typeText("n"))
  expect(ta.plainText).toBe("n\nitems n\n") // "items" untouched
})
