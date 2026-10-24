import { afterEach, expect, test } from "bun:test"
import { revealLabel } from "../../src/files/reveal"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { MouseButtons } from "@opentui/core/testing"
import { FileTree } from "../../src/files/FileTree"
import { TreeModel } from "../../src/files/TreeModel"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})

async function app(files: Record<string, string>, open: string[] = []) {
  const root = await fixture(files)
  const ws = createWorkspace(root, { focus: "tree" })
  const tree = new TreeModel(root)
  for (const f of open) await ws.buffers.open(f)
  h = await renderApp(ws, { tree: <FileTree tree={tree} height={29} />, ai: <text>AI-PANE</text> })
  await settle()
  return { h, ws, tree, root }
}

async function settle(ms = 40) {
  await Bun.sleep(ms)
  await h!.setup.renderOnce()
}

/** Type into the focused prompt input and submit. */
async function answer(text: string) {
  await h!.step(() => h!.keys.typeText(text))
  await h!.step(() => h!.keys.pressEnter())
  await settle(60)
}

test("right-click a row opens the file menu; right-click empty space offers New and revealing the project", async () => {
  const { h, tree, root } = await app({ "a.txt": "a", "b.txt": "b" })
  const b = h.find("b.txt")
  await h.step(() => h.mouse.click(b.x, b.y, MouseButtons.RIGHT))
  const f = h.frame()
  for (const item of [
    "New File…",
    "New Folder…",
    "Rename…",
    "Delete…",
    revealLabel(),
    "Copy Path",
    "Copy Relative Path",
    "Send to AI",
  ])
    expect(f).toContain(item)
  expect(tree.selected).toBe(join(root, "b.txt"))
  await h.step(() => h.keys.pressEscape())
  await settle(150)
  await h.step(() => h.mouse.click(b.x, b.y + 10, MouseButtons.RIGHT))
  expect(h.frame()).toContain("New File…")
  expect(h.frame()).not.toContain("Rename…")
  expect(h.frame()).toContain(revealLabel())
})

test("'a' creates a file (with subfolders) next to the selection and opens it", async () => {
  const { h, ws, root } = await app({ "src/x.ts": "x" })
  await h.step(() => h.keys.pressKey("a"))
  expect(h.frame()).toContain("New file")
  await answer("lib/util.ts")
  expect(existsSync(join(root, "src/lib/util.ts"))).toBe(true)
  expect(ws.buffers.active?.relPath).toBe(join("src", "lib", "util.ts"))
  expect(ws.ui.get().focus).toBe("editor")
  expect(ws.ui.get().modal).toBeNull()
})

test("an existing name shows an inline error and keeps the dialog; Esc cancels", async () => {
  const { h, ws } = await app({ "a.txt": "a" })
  await h.step(() => h.keys.pressKey("a"))
  await answer("a.txt")
  expect(h.frame()).toContain("a.txt already exists")
  expect(ws.ui.get().modal?.kind).toBe("prompt")
  await h.step(() => h.keys.pressEscape())
  await settle(150)
  expect(ws.ui.get().modal).toBeNull()
})

test("rename an open file: the tab follows, no 'deleted' state", async () => {
  const { h, ws, tree, root } = await app({ "old.ts": "content" }, ["old.ts"])
  tree.select(join(root, "old.ts"))
  ws.ui.set({ focus: "tree" })
  await settle()
  await h.step(() => h.keys.pressKey("r"))
  expect(h.frame()).toContain("Rename file")
  // The cursor starts before ".ts", so typing replaces nothing and inserts before the extension.
  await answer("er")
  expect(existsSync(join(root, "older.ts"))).toBe(true)
  expect(readFileSync(join(root, "older.ts"), "utf8")).toBe("content")
  const buf = ws.buffers.active!
  expect(buf.name).toBe("older.ts")
  expect(buf.deleted).toBe(false)
  expect(h.frame()).toContain("older.ts ×")
  expect(tree.selected).toBe(join(root, "older.ts"))
})

test("delete asks first, then removes the file and closes its clean tab", async () => {
  const { h, ws, tree, root } = await app({ "a.txt": "a", "b.txt": "b" }, ["b.txt"])
  tree.select(join(root, "b.txt"))
  ws.ui.set({ focus: "tree" })
  await settle()
  await h.step(() => h.keys.pressKey("DELETE"))
  expect(h.frame()).toContain("Permanently delete b.txt?")
  await h.step(() => h.keys.pressKey("d"))
  // Deleting is async; a loaded CI machine can take longer than a fixed pause.
  for (let i = 0; i < 80 && (existsSync(join(root, "b.txt")) || ws.buffers.list().length); i++) await settle(25)
  expect(existsSync(join(root, "b.txt"))).toBe(false)
  expect(ws.buffers.list()).toHaveLength(0)
  expect(tree.selected).toBe(join(root, "a.txt"))
})

test("icons: simple style shows coloured symbols; default shows none", async () => {
  const root = await fixture({ "src/x.ts": "x", "package.json": "{}", "notes.md": "n" })
  const ws = createWorkspace(root, { focus: "tree" })
  const tree = new TreeModel(root)
  h = await renderApp(ws, { tree: <FileTree tree={tree} height={29} icons="simple" />, ai: <text>AI-PANE</text> })
  await settle()
  const f = h.frame()
  expect(f).toContain("▸ src")
  expect(f).toContain("■ package.json") // exact name beats the .json icon
  expect(f).toContain("¶ notes.md")
  const p = h.find("▸ src")
  await h.step(() => h!.mouse.click(p.x, p.y))
  await settle()
  expect(h.frame()).toContain("◆ x.ts")
})

test("icons: nerd style shows only the folder icon, no arrow", async () => {
  const root = await fixture({ "src/x.ts": "x" })
  const ws = createWorkspace(root, { focus: "tree" })
  const tree = new TreeModel(root)
  h = await renderApp(ws, { tree: <FileTree tree={tree} height={29} icons="nerd" />, ai: <text>AI-PANE</text> })
  await settle()
  expect(h.frame()).toContain("\uf07b src")
  expect(h.frame()).not.toContain("▸")
  const p = h.find("src")
  await h.step(() => h!.mouse.click(p.x, p.y))
  await settle()
  expect(h.frame()).toContain("\uf07c src")
  expect(h.frame()).not.toContain("▾")
})

test("toolbar: New File opens the prompt; Collapse All closes the folders", async () => {
  const { h, tree, root } = await app({ "src/a.ts": "a", "lib/b.ts": "b" })
  await tree.expand(join(root, "src"))
  await settle()
  expect(h.frame()).toContain("a.ts")
  // Plain glyphs: + (file), +/ (folder), ↻ (refresh), ⊟ (collapse).
  const collapse = h.find("⊟")
  await h.step(() => h.mouse.click(collapse.x, collapse.y))
  await settle()
  expect(h.frame()).not.toContain("a.ts")
  const add = h.find("+  +/")
  await h.step(() => h.mouse.click(add.x, add.y))
  await settle()
  expect(h.frame()).toContain("New file")
})

test("drag a file onto a folder: asks, moves it, and its open tab follows", async () => {
  const { h, ws, root } = await app({ "lib/keep.ts": "k", "a.ts": "content" }, ["a.ts"])
  ws.ui.set({ focus: "tree" })
  await settle()
  // A tree row: the tab and breadcrumbs name a.ts too, further right.
  const inTree = (name: string) => {
    const y = h.lines().findIndex((l, i) => i > 0 && l.slice(0, 20).includes(name))
    return { x: h.lines()[y]!.indexOf(name), y }
  }
  const from = inTree("a.ts")
  const to = inTree("lib")
  await h.step(() => h.mouse.drag(from.x, from.y, to.x, to.y))
  await settle()
  expect(h.frame()).toContain("Move a.ts into lib/?")
  await h.step(() => h.keys.pressKey("m"))
  await settle(150)
  expect(existsSync(join(root, "lib/a.ts"))).toBe(true)
  expect(existsSync(join(root, "a.ts"))).toBe(false)
  expect(ws.buffers.active?.path).toBe(join(root, "lib/a.ts"))
  expect(h.frame()).toContain("Moved to lib/a.ts")
})

test("a drag that stays on its row is a click; a drop on its own folder does nothing", async () => {
  const { h, ws } = await app({ "lib/x.ts": "x", "a.ts": "a" })
  const a = h.find("a.ts")
  await h.step(() => h.mouse.drag(a.x, a.y, a.x + 3, a.y))
  await settle()
  expect(ws.buffers.active?.relPath).toBe("a.ts")
  expect(ws.ui.get().focus).toBe("tree")
  // Below the rows is the project root, where a.ts already is.
  await h.step(() => h.mouse.drag(a.x, a.y, a.x, a.y + 10))
  await settle()
  expect(ws.ui.get().modal).toBeNull()
})
