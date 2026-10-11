import { expect, test } from "bun:test"
import { rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { TreeModel } from "../../src/files/TreeModel"
import { fixture } from "../helpers"

test("a batch of changes reloads each folder once and redraws once", async () => {
  const root = await fixture({ "src/a.ts": "a", "src/b.ts": "b", "top.ts": "t" })
  const tree = new TreeModel(root)
  await tree.load()
  await tree.expand(join(root, "src"))
  let emits = 0
  tree.subscribe(() => emits++)
  for (let i = 0; i < 20; i++) await writeFile(join(root, "src", `new${i}.ts`), "x")
  await tree.onFsChanges(Array.from({ length: 20 }, (_, i) => join(root, "src", `new${i}.ts`)))
  expect(emits).toBe(1)
  expect(tree.rows().filter((r) => r.entry.name.startsWith("new"))).toHaveLength(20)
})

test("the Ctrl+P list survives edits to listed files, and refreshes for new or deleted ones", async () => {
  const root = await fixture({ "a.ts": "a", "b.ts": "b" })
  const tree = new TreeModel(root)
  const first = tree.files()
  expect((await first).files.sort()).toEqual(["a.ts", "b.ts"])
  await Bun.sleep(0) // the list's paths are noted once it resolves
  await writeFile(join(root, "a.ts"), "edited")
  await tree.onFsChanges([join(root, "a.ts")])
  expect(tree.files()).toBe(first)
  await writeFile(join(root, "c.ts"), "new")
  await tree.onFsChanges([join(root, "c.ts")])
  expect((await tree.files()).files.sort()).toEqual(["a.ts", "b.ts", "c.ts"])
  await Bun.sleep(0)
  await rm(join(root, "b.ts"))
  await tree.onFsChanges([join(root, "b.ts")])
  expect((await tree.files()).files.sort()).toEqual(["a.ts", "c.ts"])
})
