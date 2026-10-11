import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"
import { MouseButtons } from "@opentui/core/testing"
import { FileTree } from "../../src/files/FileTree"
import { FilePicker } from "../../src/files/FilePicker"
import { TreeModel } from "../../src/files/TreeModel"
import { paneWidths } from "../../src/app/App"
import { createWorkspace, fixture, numbered, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})

async function app(files: Record<string, string>, open: string[] = [], size = { width: 140, height: 30 }) {
  const root = await fixture(files)
  const ws = createWorkspace(root)
  const tree = new TreeModel(root)
  for (const f of open) await ws.buffers.open(f)
  h = await renderApp(ws, { tree: <FileTree tree={tree} height={size.height - 1} />, picker: <FilePicker tree={tree} />, ai: <text>AI-PANE</text> }, size)
  await Bun.sleep(50)
  await h.setup.renderOnce()
  return { h, ws, tree, root }
}

const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${String(i).padStart(2, "0")}.txt`, "x"]))

// ---- tree ----
test("tree: wheel scrolls the list without changing the selection", async () => {
  const { h, tree } = await app(many)
  const first = tree.selected
  const p = h.find("f00.txt")
  for (let i = 0; i < 3; i++) await h.step(() => h.mouse.scroll(p.x, p.y + 2, "down"))
  expect(h.frame()).not.toContain("f00.txt")
  expect(h.frame()).toContain("f09.txt")
  expect(tree.selected).toBe(first)
})

test("tree: clicking a folder toggles it and focuses the tree; clicking a file opens it in the editor", async () => {
  const { h, ws } = await app({ "src/a.ts": "a", "src/b.ts": "b", "README.md": "r" })
  ws.ui.set({ focus: "editor" })
  const dir = h.find("▸ src")
  await h.step(() => h.mouse.click(dir.x + 2, dir.y))
  await Bun.sleep(30)
  await h.setup.renderOnce()
  expect(h.frame()).toContain("▾ src")
  expect(ws.ui.get().focus).toBe("tree")
  const file = h.find("b.ts")
  await h.step(() => h.mouse.click(file.x, file.y))
  await Bun.sleep(30)
  expect(ws.buffers.active?.relPath).toBe(join("src", "b.ts"))
  expect(ws.ui.get().focus).toBe("editor")
})

// ---- tabs ----
test("tabs: click switches, × closes, middle-click closes, wheel cycles", async () => {
  const { h, ws } = await app({ "a.txt": "a", "b.txt": "b", "c.txt": "c" }, ["a.txt", "b.txt", "c.txt"])
  // The editor starts right after the tree's 1-column divider; its tab row is the top row.
  const edX = paneWidths(140, ws.ui.get(), true, true).treeWidth + 1
  const tabRow = 0
  const tabA = h.findAt("a.txt", edX).x
  await h.step(() => h.mouse.click(tabA, tabRow))
  expect(ws.buffers.active?.name).toBe("a.txt")

  await h.step(() => h.mouse.scroll(tabA, tabRow, "down"))
  expect(ws.buffers.active?.name).toBe("b.txt")

  const cX = h.lines()[tabRow]!.indexOf("c.txt", edX)
  await h.step(() => h.mouse.click(cX, tabRow, MouseButtons.MIDDLE))
  expect(ws.buffers.list().map((b) => b.name)).toEqual(["a.txt", "b.txt"])

  const line = h.lines()[tabRow]!
  const closeA = line.indexOf("×", line.indexOf("a.txt", edX))
  await h.step(() => h.mouse.click(closeA, tabRow))
  expect(ws.buffers.list().map((b) => b.name)).toEqual(["b.txt"])
})

test("tabs: × on a dirty tab asks before closing", async () => {
  const { h, ws } = await app({ "a.txt": "a" }, ["a.txt"])
  await h.step(() => {
    ws.buffers.active!.textarea!.insertText("Z")
    ws.buffers.onContentChange(ws.buffers.active!.id)
  })
  const tabRow = 0
  const tabX = h.findAt("a.txt", paneWidths(140, ws.ui.get(), true, true).treeWidth + 1).x
  await h.step(() => h.mouse.moveTo(tabX, tabRow))
  const close = h.lines()[tabRow]!.indexOf("×", tabX)
  await h.step(() => h.mouse.click(close, tabRow))
  expect(h.frame()).toContain("Close tab")
  expect(ws.buffers.list()).toHaveLength(1)
})

// ---- modals ----
test("picker: hover selects, wheel moves, click opens, click outside closes", async () => {
  const { h, ws } = await app({ "one.txt": "1", "two.txt": "2", "three.txt": "3" })
  await h.step(() => ws.ui.set({ modal: { kind: "picker" } }))
  await Bun.sleep(50)
  await h.setup.renderOnce()
  const title = h.find("Go to file")
  const one = h.findAt("one.txt", title.x - 3, title.y)
  const two = h.findAt("two.txt", title.x - 3, title.y)
  // hover highlights a row; the wheel moves the highlight
  await h.step(() => h.mouse.moveTo(one.x, one.y))
  const selBg = (y: number) => h.setup.renderer.currentRenderBuffer.buffers.bg.slice((y * 140 + one.x) * 4, (y * 140 + one.x) * 4 + 3).join()
  const highlighted = selBg(one.y)
  expect(highlighted).not.toBe(selBg(two.y))
  await h.step(() => h.mouse.scroll(one.x, one.y, "down"))
  await h.step(() => h.mouse.scroll(one.x, one.y, "down"))
  expect(selBg(two.y)).toBe(highlighted)
  await h.step(() => h.mouse.click(two.x, two.y))
  await Bun.sleep(30)
  expect(ws.buffers.active?.name).toBe("two.txt")
  expect(ws.ui.get().modal).toBeNull()

  await h.step(() => ws.ui.set({ modal: { kind: "picker" } }))
  await h.step(() => h.mouse.click(1, 28))
  expect(ws.ui.get().modal).toBeNull()
})

test("confirm dialog: options are clickable and clicking outside cancels", async () => {
  const { h, ws } = await app({ "a.txt": "a" })
  let ran = ""
  const show = () =>
    ws.ui.set({
      modal: {
        kind: "confirm",
        title: "Pick",
        body: "Choose",
        options: [
          { key: "y", label: "Yes please", run: () => void ((ran = "y"), ws.ui.set({ modal: null })) },
          { key: "n", label: "No thanks", run: () => void ((ran = "n"), ws.ui.set({ modal: null })) },
        ],
      },
    })
  await h.step(show)
  const no = h.find("No thanks")
  await h.step(() => h.mouse.click(no.x, no.y))
  expect(ran).toBe("n")
  await h.step(show)
  await h.step(() => h.mouse.click(0, 0))
  expect(ws.ui.get().modal).toBeNull()
})

// ---- status bar ----
test("status bar: hints are clickable", async () => {
  const { h, ws } = await app({ "a.txt": "a" })
  const keys = h.find("F1 commands")
  await h.step(() => h.mouse.click(keys.x + 1, keys.y))
  expect(ws.ui.get().modal?.kind).toBe("palette")
})

// ---- pane resize ----
test("dragging the tree and AI borders resizes the panes", async () => {
  const { h, ws } = await app({ "a.txt": "a" })
  const before = paneWidths(140, ws.ui.get(), true, true)
  // Dividers: tree | divider at x=treeWidth | editor | divider | ai.
  const treeBorder = before.treeWidth
  await h.step(() => h.mouse.pressDown(treeBorder, 10))
  await h.step(() => h.mouse.moveTo(treeBorder + 10, 10))
  await h.step(() => h.mouse.release(treeBorder + 10, 10))
  expect(ws.ui.get().treeWidth).toBe(before.treeWidth + 10)
  expect(ws.ui.get().resizing).toBeNull()

  const aiBorder = 140 - before.aiWidth - 1
  await h.step(() => h.mouse.pressDown(aiBorder, 10))
  await h.step(() => h.mouse.moveTo(aiBorder + 15, 10))
  await h.step(() => h.mouse.release(aiBorder + 15, 10))
  expect(ws.ui.get().aiWidth).toBe(before.aiWidth - 15)
  expect(ws.ui.get().resizing).toBeNull()
  // The AI pane starts right after the moved divider.
  expect(h.find("AI-PANE").x).toBe(aiBorder + 16)
})

test("double-clicking a border puts that pane back to its default width; a single click leaves it", async () => {
  const { h, ws } = await app({ "a.txt": "a" })
  const auto = paneWidths(140, ws.ui.get(), true, true)
  ws.ui.set({ treeWidth: auto.treeWidth + 8, aiWidth: auto.aiWidth - 12 })
  await h.step(() => {})
  const treeBorder = auto.treeWidth + 8
  const aiBorder = 140 - (auto.aiWidth - 12) - 1
  const click = async (x: number) => {
    await h.step(() => h.mouse.pressDown(x, 10))
    await h.step(() => h.mouse.release(x, 10))
  }
  await click(treeBorder)
  await Bun.sleep(450) // too slow for a double-click
  await click(treeBorder)
  expect(ws.ui.get().treeWidth).toBe(auto.treeWidth + 8)
  await Bun.sleep(450)
  await click(treeBorder)
  await click(treeBorder)
  expect(ws.ui.get().treeWidth).toBeNull()
  expect(ws.ui.get().resizing).toBeNull()
  await click(aiBorder)
  await click(aiBorder)
  expect(ws.ui.get().aiWidth).toBeNull()
  expect(paneWidths(140, ws.ui.get(), true, true)).toEqual(auto)
})

test("pane widths are clamped so the editor keeps room", () => {
  expect(paneWidths(140, { treeWidth: 5, aiWidth: null }, true, true).treeWidth).toBe(14)
  const w = paneWidths(140, { treeWidth: 100, aiWidth: 100 }, true, true)
  expect(140 - w.treeWidth - w.aiWidth).toBeGreaterThanOrEqual(30)
})

// ---- gutter ----
test("gutter: click selects a line, drag selects a range", async () => {
  const { h, ws } = await app({ "a.txt": numbered(20) }, ["a.txt"])
  const l3 = h.find("3 line 3")
  await h.step(() => h.mouse.click(l3.x, l3.y))
  const ta = ws.buffers.active!.textarea!
  expect(ta.getSelectedText()).toBe("line 3\n")
  expect(ws.ui.get().focus).toBe("editor")
  await h.step(() => h.mouse.drag(l3.x, l3.y, l3.x, l3.y + 2))
  expect(ta.getSelectedText()).toBe("line 3\nline 4\nline 5\n")
  expect(h.lines().at(-2)).toContain("Ln 6, Col 1")
  await h.step(() => h.mouse.drag(l3.x, l3.y, l3.x, l3.y - 1))
  expect(ta.getSelectedText()).toBe("line 2\nline 3\n")
  expect(h.lines().at(-2)).toContain("Ln 2, Col 1")
})

// ---- tab strip overflow ----
test("firstVisibleTab keeps the active tab in view without jumping", async () => {
  const { firstVisibleTab } = await import("../../src/editor/Tabs")
  const w = [10, 10, 10, 10, 10] // 5 tabs, 10 cells each, gap 1
  expect(firstVisibleTab(w, 0, 32, 0)).toBe(0)
  expect(firstVisibleTab(w, 2, 32, 0)).toBe(0) // 0..2 = 32 cells: fits
  expect(firstVisibleTab(w, 3, 32, 0)).toBe(1)
  expect(firstVisibleTab(w, 4, 32, 1)).toBe(2)
  expect(firstVisibleTab(w, 3, 32, 2)).toBe(2) // moving back inside the window: no jump
  expect(firstVisibleTab(w, 1, 32, 2)).toBe(1)
  expect(firstVisibleTab(w, 4, 100, 3)).toBe(0) // everything fits again
})

test("clicking the empty editor pane (no file open) focuses it", async () => {
  const root = await fixture({ "a.txt": "x\n" })
  const ws = createWorkspace(root, { focus: "tree" })
  const hh = await renderApp(ws, { tree: <text>TREE</text> })
  h = hh
  const p = hh.find("No file open")
  await hh.step(() => hh.mouse.click(p.x + 3, p.y))
  expect(ws.ui.get().focus).toBe("editor")
  // Empty space and the border count too.
  ws.ui.set({ focus: "tree" })
  await hh.step(() => hh.mouse.click(p.x + 3, p.y - 4))
  expect(ws.ui.get().focus).toBe("editor")
})

test("breadcrumbs show the file's folders; clicking one reveals it in the tree", async () => {
  const { h, ws, tree, root } = await app({ "src/deep/b.ts": "x", "a.txt": "a" }, ["src/deep/b.ts"])
  expect(h.frame()).toContain("src › deep › b.ts")
  const src = h.findAt("src ›", paneWidths(140, ws.ui.get(), true, true).treeWidth + 1)
  await h.step(() => h.mouse.click(src.x, src.y))
  await Bun.sleep(60)
  await h.setup.renderOnce()
  expect(ws.ui.get().focus).toBe("tree")
  expect(tree.selected).toBe(join(root, "src"))
})
