import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"
import { FileTree } from "../../src/files/FileTree"
import { TreeModel } from "../../src/files/TreeModel"
import { createWorkspace, fixture, renderApp, waitUntil, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => h?.setup.renderer.destroy())
const until = (cond: () => boolean) => waitUntil(cond, 4000, () => h?.setup.renderOnce())

/** A narrow tree with src/averyveryverylongfilename.ts open. */
async function narrow(width = 16) {
  const root = await fixture({ "src/averyveryverylongfilename.ts": "x", "src/b.ts": "b", "a.txt": "a" })
  const ws = createWorkspace(root, { treeWidth: width, focus: "tree" })
  const tree = new TreeModel(root)
  h = await renderApp(ws, { tree: <FileTree tree={tree} height={29} icons="simple" /> })
  await until(() => h!.frame().includes("src"))
  await tree.toggle(join(root, "src"))
  await until(() => h!.frame().includes("b.ts"))
  return { root, tree, ws }
}
const row = (s: string) => h!.lines().find((l) => l.includes(s)) ?? ""

test("a narrow tree clips long names at its edge, with no … or ...", async () => {
  await narrow()
  const r = row("◆ avery")
  expect(r).not.toContain("…")
  expect(r).not.toContain("...")
  expect(r).not.toContain("filename.ts") // cut at the edge
})

test("narrow trees indent one column per level, wide ones two", async () => {
  await narrow(20)
  expect(row("b.ts")).toMatch(/│?\s?  ◆ b\.ts/) // padding + 1 indent
  expect(row("b.ts").indexOf("◆")).toBe(row("src").indexOf("▾") + 1)
})

test("Shift+wheel (or a sideways swipe) scrolls the rows sideways, as far as the longest name needs", async () => {
  await narrow()
  const at = h!.find("b.ts")
  for (let i = 0; i < 10; i++) await h!.step(() => h!.mouse.scroll(at.x, at.y, "down", { modifiers: { shift: true } }))
  await until(() => row("filename.ts").includes("filename.ts"))
  // No further than the end of the longest row: it ends right at the edge (before the marks' columns).
  expect(row("filename.ts")).toMatch(/^ gfilename\.ts {3}│/)
  for (let i = 0; i < 10; i++) await h!.step(() => h!.mouse.scroll(at.x, at.y, "left"))
  await until(() => row("averyvery").includes("◆ averyvery"))
})

test("moving the selection onto a long name scrolls it into view", async () => {
  const { root, tree } = await narrow()
  tree.select(join(root, "src/b.ts"))
  await h!.step(() => h!.keys.pressArrow("up"))
  await until(() => tree.selected === join(root, "src/averyveryverylongfilename.ts"))
  // Its start shows: the name begins at the left edge (scrolled past the indent and icon), or fits.
  await until(() => /averyvery/.test(row("avery")))
})
