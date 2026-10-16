import { expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { countEntries, createFile, createFolder, deletePath, movePath, renamePath, validateName } from "../../src/files/fileOps"
import { fixture } from "../helpers"

test("validateName rejects empty, absolute, .. and NUL names", () => {
  expect(validateName("  ")).not.toBeNull()
  expect(validateName("/etc/x")).not.toBeNull()
  expect(validateName("a/../b")).not.toBeNull()
  expect(validateName("a\0b")).not.toBeNull()
  expect(validateName("./")).not.toBeNull()
  expect(validateName("src/new.ts")).toBeNull()
})

test("createFile makes parent folders and refuses existing files", async () => {
  const root = await fixture({ "a.txt": "keep" })
  const p = await createFile(root, " lib/deep/x.ts ")
  expect(p).toBe(join(root, "lib/deep/x.ts"))
  expect(readFileSync(p, "utf8")).toBe("")
  await expect(createFile(root, "a.txt")).rejects.toThrow("already exists")
  expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("keep")
})

test("createFolder and renamePath (file, folder, refuses clobbering)", async () => {
  const root = await fixture({ "a.txt": "A", "b.txt": "B" })
  const dir = await createFolder(root, "pkg/sub")
  expect(existsSync(dir)).toBe(true)
  await expect(createFolder(root, "pkg")).rejects.toThrow("already exists")
  expect(await renamePath(join(root, "a.txt"), "c.txt")).toBe(join(root, "c.txt"))
  expect(readFileSync(join(root, "c.txt"), "utf8")).toBe("A")
  await expect(renamePath(join(root, "c.txt"), "b.txt")).rejects.toThrow("already exists")
  expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("B")
  writeFileSync(join(dir, "f.ts"), "F")
  expect(await renamePath(join(root, "pkg"), "lib")).toBe(join(root, "lib"))
  expect(readFileSync(join(root, "lib/sub/f.ts"), "utf8")).toBe("F")
})

test("deletePath removes folders recursively; countEntries counts what is inside", async () => {
  const root = await fixture({ "d/a.txt": "a", "d/e/b.txt": "b" })
  mkdirSync(join(root, "d/empty"))
  expect(await countEntries(join(root, "d"))).toBe(4) // a.txt, e, e/b.txt, empty
  await deletePath(join(root, "d"))
  expect(existsSync(join(root, "d"))).toBe(false)
  await expect(deletePath(join(root, "nope"))).rejects.toThrow()
})

test("movePath moves into another folder and refuses itself, its own subfolders and clashes", async () => {
  const root = await fixture({ "a.txt": "A", "lib/a.txt": "other", "d/e/f.txt": "F", "x.txt": "X" })
  expect(await movePath(join(root, "x.txt"), join(root, "d/e"))).toBe(join(root, "d/e/x.txt"))
  expect(readFileSync(join(root, "d/e/x.txt"), "utf8")).toBe("X")
  expect(await movePath(join(root, "d/e"), root)).toBe(join(root, "e"))
  expect(readFileSync(join(root, "e/f.txt"), "utf8")).toBe("F")
  await expect(movePath(join(root, "d"), join(root, "d"))).rejects.toThrow("into itself")
  mkdirSync(join(root, "d/inner"))
  await expect(movePath(join(root, "d"), join(root, "d/inner"))).rejects.toThrow("into itself")
  await expect(movePath(join(root, "a.txt"), join(root, "lib"))).rejects.toThrow("already exists")
  expect(readFileSync(join(root, "lib/a.txt"), "utf8")).toBe("other")
})
