import { afterEach, beforeEach, expect, test } from "bun:test"
import { FilePicker } from "../../src/files/FilePicker"
import { TreeModel } from "../../src/files/TreeModel"
import { resetNavHistory } from "../../src/app/navHistory"
import { createWorkspace, fixture, numbered, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
beforeEach(() => resetNavHistory())
afterEach(() => h?.setup.renderer.destroy())

const code = [
  "import x from 'y'",
  "",
  "export function alpha() {",
  "  return 1",
  "}",
  "",
  "class Beta {",
  "  gamma(a) {",
  "  }",
  "}",
  ...numbered(60).split("\n"),
].join("\n")

async function app() {
  const root = await fixture({ "a.ts": code, "b.ts": "b\n", "c.ts": "c\n" })
  const ws = createWorkspace(root)
  const tree = new TreeModel(root)
  await ws.buffers.open("c.ts")
  await ws.buffers.open("b.ts")
  await ws.buffers.open("a.ts")
  h = await renderApp(ws, { tree: <text>TREE</text>, picker: <FilePicker tree={tree} /> })
  await Bun.sleep(40)
  await h.setup.renderOnce()
  return { ws }
}
const settle = async (ms = 60) => {
  await Bun.sleep(ms)
  await h!.setup.renderOnce()
}

test("empty Ctrl+P lists recent files first (not the current one)", async () => {
  await app()
  await h!.step(() => h!.keys.pressKey("p", { ctrl: true }))
  await settle()
  const rows = h!.lines().filter((l) => /[abc]\.ts/.test(l) && l.includes("recent"))
  expect(rows.map((l) => l.match(/[abc]\.ts/)![0])).toEqual(["b.ts", "c.ts"])
})

test("@ lists symbols of the file and Enter jumps; Ctrl+Alt+← goes back, → forward", async () => {
  const { ws } = await app()
  const ta = ws.buffers.active!.textarea!
  ta.setCursor(40, 0)
  await h!.step(() => h!.keys.pressKey("p", { ctrl: true }))
  await h!.step(() => h!.keys.typeText("@gam"))
  await settle()
  expect(h!.frame()).toContain("gamma")
  await h!.step(() => h!.keys.pressEnter())
  await settle(120)
  expect(ta.logicalCursor.row).toBe(7)
  expect(ta.getSelectedText()).toBe("gamma")
  // Back to line 41, then forward to gamma again.
  await h!.step(() => h!.keys.pressArrow("left", { ctrl: true, meta: true }))
  await settle(120)
  expect(ta.logicalCursor.row).toBe(40)
  await h!.step(() => h!.keys.pressArrow("right", { ctrl: true, meta: true }))
  await settle(120)
  expect(ta.logicalCursor.row).toBe(7)
})

test(":line in Ctrl+P goes to the line", async () => {
  const { ws } = await app()
  await h!.step(() => h!.keys.pressKey("p", { ctrl: true }))
  await h!.step(() => h!.keys.typeText(":30"))
  await settle()
  expect(h!.frame()).toContain("Go to line 30")
  await h!.step(() => h!.keys.pressEnter())
  await settle()
  expect(ws.buffers.active!.textarea!.logicalCursor.row).toBe(29)
})
