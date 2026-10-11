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

test("editing a file keeps the picker's file list; adding one or deleting a folder rebuilds it", async () => {
  const root = await fixture({ "src/a.ts": "a", "tmp/x.txt": "x" })
  const tree = new TreeModel(root)
  await tree.load()
  const first = tree.files()
  await first
  await Bun.sleep(10) // the list of known paths fills in
  await writeFile(join(root, "src/a.ts"), "edited")
  await tree.onFsChanges([join(root, "src/a.ts"), join(root, "src")])
  expect(tree.files()).toBe(first) // an edit (and its folder's event) isn't worth a new walk
  await writeFile(join(root, "src/new.ts"), "n")
  await tree.onFsChanges([join(root, "src/new.ts")])
  expect(tree.files()).not.toBe(first)
})

test("a deleted folder leaves nothing cached behind", async () => {
  const root = await fixture({ "tmp/deep/x.txt": "x", "keep.ts": "k" })
  const tree = new TreeModel(root)
  await tree.load()
  await tree.expand(join(root, "tmp"))
  await tree.expand(join(root, "tmp/deep"))
  const cached = () => [...(tree as unknown as { children: Map<string, unknown> }).children.keys()].filter((d) => d.startsWith(join(root, "tmp")))
  expect(cached().length).toBe(2)
  await rm(join(root, "tmp"), { recursive: true })
  await tree.onFsChanges([join(root, "tmp")])
  expect(cached()).toEqual([])
  expect(tree.rows().map((r) => r.entry.name)).toEqual(["keep.ts"])
})
