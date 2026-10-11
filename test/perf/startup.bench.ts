/**
 * Big-repo startup benchmark: `bun run test/perf/startup.bench.ts`. Not part of `bun test`.
 * Times the watcher's initial crawl and the Ctrl+P file walk on a generated tree.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileWatcher } from "../../src/files/watcher"
import { TreeModel } from "../../src/files/TreeModel"
import { IgnoreMatcher } from "../../src/files/ignore"
import { walkFiles } from "../../src/files/walk"

const root = join(tmpdir(), "ce-startup-bench")
if (!(await Bun.file(join(root, ".done")).exists())) {
  // 6 x 6 x 6 x 16 folders (~3.6k), 10 files each, plus ignored build output.
  await writeFile(join(root, ".gitignore"), "dist/\n*.log\ncoverage\n").catch(async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, ".gitignore"), "dist/\n*.log\ncoverage\n")
  })
  const jobs: Promise<unknown>[] = []
  for (let a = 0; a < 6; a++)
    for (let b = 0; b < 6; b++)
      for (let c = 0; c < 6; c++)
        for (let d = 0; d < 16; d++) {
          const dir = join(root, `pkg${a}`, `mod${b}`, `part${c}`, `leaf${d}`)
          jobs.push(
            mkdir(dir, { recursive: true }).then(() =>
              Promise.all(Array.from({ length: 10 }, (_, i) => writeFile(join(dir, `file${i}.${i % 3 ? "ts" : "log"}`), "x"))),
            ),
          )
        }
  await Promise.all(jobs)
  await writeFile(join(root, ".done"), "")
}

async function time(label: string, f: () => Promise<unknown>) {
  const s = performance.now()
  const r = await f()
  console.log(`${label.padEnd(14)} ${(performance.now() - s).toFixed(0)}ms`, r ?? "")
}
for (let i = 0; i < 2; i++) {
  await time("watcher crawl", async () => {
    const w = new FileWatcher(root, () => {}, 100, new IgnoreMatcher(root))
    await w.start()
    const n = w.watchedDirs
    w.stop()
    return `${n} folders`
  })
  await time("ctrl+p walk", async () => `${(await walkFiles(root, new IgnoreMatcher(root))).files.length} files`)
  await time("both, shared", async () => {
    const tree = new TreeModel(root)
    const w = new FileWatcher(root, () => {}, 100, tree.matcher)
    await Promise.all([w.start(), tree.files()])
    w.stop()
  })
}
