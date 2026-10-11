import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { affectedOpenFiles, FileWatcher, type ChangeBatch } from "../../src/files/watcher"
import { waitUntil } from "../helpers"

test("batches nested changes, skips .git and node_modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "cedit-watch-"))
  await mkdir(join(root, "src/deep"), { recursive: true })
  await mkdir(join(root, ".git"))
  await mkdir(join(root, "node_modules"))
  const batches: ChangeBatch[] = []
  const w = new FileWatcher(root, (b) => batches.push(b), 50)
  await w.start()
  await Bun.sleep(50)
  await writeFile(join(root, "src/deep/a.ts"), "1")
  await writeFile(join(root, "src/deep/b.ts"), "1")
  await writeFile(join(root, ".git/index"), "x")
  await writeFile(join(root, "node_modules/x.js"), "x")
  const all = () => new Set(batches.flatMap((b) => [...b.paths]))
  await waitUntil(() => all().has(join(root, "src/deep/a.ts")) && all().has(join(root, "src/deep/b.ts")), 3000)
  await Bun.sleep(100) // past the debounce: anything that would make a second batch has arrived
  w.stop()
  expect([...all()].some((p) => p.includes(".git") || p.includes("node_modules"))).toBe(false)
  // macOS (FSEvents) can deliver a straggler after the debounce.
  expect(batches.length).toBeLessThanOrEqual(process.platform === "darwin" ? 2 : 1)
})

test("atomic saves are caught through the directory of the temp file", async () => {
  const root = await mkdtemp(join(tmpdir(), "cedit-watch-"))
  const target = join(root, "file.ts")
  await writeFile(target, "v1")
  const batches: ChangeBatch[] = []
  const w = new FileWatcher(root, (b) => batches.push(b), 50)
  await w.start()
  await Bun.sleep(50)
  await writeFile(join(root, ".file.ts.tmp"), "v2")
  await rename(join(root, ".file.ts.tmp"), target)
  const hits = () => batches.flatMap((b) => affectedOpenFiles(b, [target, join(root, "other/x.ts")]))
  await waitUntil(() => hits().length > 0, 3000)
  w.stop()
  expect([...new Set(hits())]).toEqual([target])
})

test("skips node_modules and .git folders, and starts watching new folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "cedit-watch-"))
  await mkdir(join(root, "node_modules/pkg/deep"), { recursive: true })
  await mkdir(join(root, ".git/objects"), { recursive: true })
  await mkdir(join(root, "src"))
  const batches: ChangeBatch[] = []
  const w = new FileWatcher(root, (b) => batches.push(b), 50)
  await w.start()
  expect(w.watchedDirs).toBe(2) // root and src
  await mkdir(join(root, "src/new"))
  await waitUntil(() => w.watchedDirs === 3, 3000) // the new folder is watched
  await writeFile(join(root, "src/new/x.ts"), "x")
  await waitUntil(() => batches.some((b) => b.paths.has(join(root, "src/new/x.ts"))), 3000)
  w.stop()
})
