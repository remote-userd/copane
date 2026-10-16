import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"
import { Sidebar } from "../../src/app/Sidebar"
import { forgetLastSearch } from "../../src/files/SearchPanel"
import { SearchPanel } from "../../src/files/SearchPanel"
import { TreeModel } from "../../src/files/TreeModel"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

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
  const sidebar = <Sidebar files={<text>TREE BODY</text>} search={<SearchPanel tree={tree} height={26} mode="sidebar" />} />
  h = await renderApp(ws, { tree: sidebar }, { width: 160, height: 30 })
  await settle()
  return { h, ws, root }
}
const settle = async (ms = 40) => {
  await Bun.sleep(ms)
  await h!.setup.renderOnce()
}
const waitFor = async (text: string) => {
  for (let i = 0; i < 40 && !h!.frame().includes(text); i++) await settle(30)
  expect(h!.frame()).toContain(text)
}
const ed = (ws: ReturnType<typeof createWorkspace>) => ws.buffers.active!.textarea!

test("Ctrl+Alt+F: the SEARCH tab, seeded with the word; Enter walks results and keeps focus; Esc to the editor", async () => {
  const { h, ws, root } = await app({ "a.ts": "let oldName = 1\n", "src/b.ts": "oldName()\noldNameX\n" })
  ed(ws).setCursor(0, 6)
  await h.step(() => h.keys.pressKey("f", { ctrl: true, meta: true }))
  expect(ws.ui.get()).toMatchObject({ sidebar: "search", focus: "tree" })
  await waitFor("3 in 2 files") // seeded with "oldName"
  // Typing replaces the seeded word.
  await h.step(() => h.keys.typeText("oldNameX"))
  await waitFor("1 in 1 file")
  await h.step(() => h.keys.pressArrow("down"))
  await h.step(() => h.keys.pressEnter())
  await settle(150)
  expect(ws.buffers.active?.path).toBe(join(root, "src/b.ts"))
  expect(ed(ws).getSelectedText()).toBe("oldNameX")
  expect(ws.ui.get().focus).toBe("tree") // still in the results
  await h.step(() => h.keys.pressEscape())
  await settle(150)
  expect(ws.ui.get().focus).toBe("editor")
  // Alt+E (focus the tree) from the search tab shows the tree.
  await h.step(() => h.keys.pressKey("f", { ctrl: true, meta: true }))
  await h.step(() => h.keys.pressKey("e", { meta: true }))
  expect(ws.ui.get().sidebar).toBe("files")
  expect(h.frame()).toContain("TREE BODY")
})

test("keyboard replace: Ctrl+F row, Alt+W, Alt+Enter confirms; open files change in place, others on disk", async () => {
  const { h, ws, root } = await app({ "a.ts": "let oldName = 1\n", "src/b.ts": "oldName()\noldNameX\n" })
  await h.step(() => h.keys.pressKey("f", { ctrl: true, meta: true }))
  await h.step(() => h.keys.typeText("oldName"))
  await h.step(() => h.keys.pressKey("f", { ctrl: true }))
  await h.step(() => h.keys.pressKey("w", { meta: true })) // whole word: not oldNameX
  await h.step(() => h.keys.pressTab())
  await h.step(() => h.keys.typeText("newName"))
  await waitFor("2 in 2 files")
  await h.step(() => h.keys.pressEnter({ meta: true }))
  await waitFor('2 files: "oldName" → "newName"')
  await h.step(() => h.keys.typeText("y"))
  await waitFor("Replaced in 2 files")
  expect(ed(ws).plainText).toBe("let newName = 1\n")
  expect(ws.buffers.active!.dirty).toBe(true)
  expect(await Bun.file(join(root, "src/b.ts")).text()).toBe("newName()\noldNameX\n")
  ed(ws).undo()
  expect(ed(ws).plainText).toBe("let oldName = 1\n")
})

test("mouse: tabs, ▸ replace, toggles, × dismisses, ⇄ on a match and on a file, Replace all skips dismissed", async () => {
  const { h, ws, root } = await app({ "a.ts": "x\n", "src/b.ts": "foo one\nfoo two\nfoo three\nfoobar\n", "c.ts": "foo c\n" })
  const click = async (text: string, minY = 0, minX = 0) => {
    const p = h.findAt(text, minX, minY)
    await h.step(() => h.mouse.click(p.x, p.y))
    await settle()
  }
  const hover = async (text: string) => {
    const p = h.find(text)
    await h.step(() => h.mouse.moveTo(p.x, p.y))
    await settle()
    return p
  }
  await click("SEARCH")
  expect(ws.ui.get()).toMatchObject({ sidebar: "search", focus: "tree" })
  await h.step(() => h.keys.typeText("foo"))
  await waitFor("5 in 2 files")
  await click("ab")
  await waitFor("4 in 2 files")
  await click("▸")
  await h.step(() => h.keys.typeText("baz")) // ▸ put the cursor in the replace field

  // × on "foo two" leaves it out.
  const two = await hover("foobaz two") // old, then the replacement
  await click("×", two.y, 20)
  await waitFor("1 hidden")

  // ⇄ on "foo one" replaces just it.
  const one = await hover("foobaz one")
  await click("⇄", one.y)
  await waitFor("Replaced in src/b.ts:1")
  expect(await Bun.file(join(root, "src/b.ts")).text()).toBe("baz one\nfoo two\nfoo three\nfoobar\n")

  // ⇄ on the c.ts header replaces the whole file.
  const c = await hover("c.ts")
  await click("⇄", c.y)
  await waitFor("Replaced in c.ts")
  expect(await Bun.file(join(root, "c.ts")).text()).toBe("baz c\n")

  // ⇄ All asks first; the confirm's [y] is clickable; the dismissed line stays.
  await click("⇄ All")
  await waitFor("skipped")
  await click("[y]")
  await waitFor("Replaced in 1 file")
  expect(await Bun.file(join(root, "src/b.ts")).text()).toBe("baz one\nfoo two\nbaz three\nfoobar\n")

  // Back to the tree by its tab.
  await click("FILES")
  expect(h.frame()).toContain("TREE BODY")
})

test("the sidebar does not show the project folder name", async () => {
  const { h, root } = await app({ "a.ts": "x\n" })
  const name = root.split("/").pop()!
  const top = h.frame().split("\n").find((l) => l.includes("FILES") || l.includes("\u{f02dc}"))!
  // The temp folder's random tail: nothing else on the row could contain it.
  expect(top).not.toContain(name.slice(-4))
})
