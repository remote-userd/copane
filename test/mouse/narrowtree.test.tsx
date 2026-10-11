import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"
import { FileTree } from "../../src/files/FileTree"
import { TreeModel } from "../../src/files/TreeModel"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => h?.setup.renderer.destroy())

test("a narrow tree shortens long names with … instead of leaving them blank", async () => {
  const root = await fixture({ "src/averyveryverylongfilename.ts": "x", "a.txt": "a" })
  const ws = createWorkspace(root, { treeWidth: 16 })
  const tree = new TreeModel(root)
  h = await renderApp(ws, { tree: <FileTree tree={tree} height={29} icons="simple" /> })
  await Bun.sleep(60)
  await tree.toggle(join(root, "src"))
  await Bun.sleep(30)
  await h.setup.renderOnce()
  const row = h.lines().find((l) => l.includes("◆"))!
  expect(row).toMatch(/◆ av.*\.\.\..*\.ts/)
})
