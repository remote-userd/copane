/**
 * What each part of a window costs in memory: `bun run test/perf/memory.bench.ts`. Not part of
 * `bun test`. Renders the app headlessly on a generated project and reports, after each step,
 * the process's private memory (RssAnon on Linux, else RSS) and the JS heap, before and after a
 * full garbage collection (the difference is garbage the process still holds).
 * FILE=path opens another file; HL=bytes sets editor.highlightMaxBytes (1 turns highlighting off).
 */
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { heapStats } from "bun:jsc"
import { destroyTreeSitterClient, EmbeddedTerminalRenderable } from "@opentui/core"
import { createWorkspace, renderApp } from "../helpers"
import { FileTree } from "../../src/files/FileTree"
import { TreeModel } from "../../src/files/TreeModel"
import { GitStatus } from "../../src/files/gitStatus"
import { GitRepos } from "../../src/git/repos"

const root = join(tmpdir(), "ce-memory-bench")
if (!(await Bun.file(join(root, ".done")).exists())) {
  // ~5k files in 500 folders, a few real-looking TypeScript files, and a git repository.
  const jobs: Promise<unknown>[] = []
  for (let a = 0; a < 20; a++)
    for (let b = 0; b < 25; b++) {
      const dir = join(root, `pkg${a}`, `mod${b}`)
      jobs.push(mkdir(dir, { recursive: true }).then(() => Promise.all(Array.from({ length: 10 }, (_, i) => writeFile(join(dir, `file${i}.ts`), `export const v${i} = ${i}\n`)))))
    }
  await Promise.all(jobs)
  const big = Array.from({ length: 3000 }, (_, i) => `export function f${i}(a: number, b: string): string {\n  return \`\${a}:\${b}\` // line ${i}\n}\n`).join("")
  await writeFile(join(root, "big.ts"), big)
  Bun.spawnSync(["git", "init", "-q"], { cwd: root })
  Bun.spawnSync(["git", "-c", "user.name=b", "-c", "user.email=b@b", "add", "."], { cwd: root })
  Bun.spawnSync(["git", "-c", "user.name=b", "-c", "user.email=b@b", "commit", "-qm", "init"], { cwd: root })
  await writeFile(join(root, ".done"), "")
}

async function privateBytes(): Promise<number> {
  const status = await Bun.file("/proc/self/status")
    .text()
    .catch(() => "")
  const kb = /RssAnon:\s+(\d+) kB/.exec(status)?.[1]
  return kb ? Number(kb) * 1024 : process.memoryUsage().rss
}
const mb = (n: number) => (n / 1048576).toFixed(1).padStart(7)
const rows: string[] = []
let last = 0
async function step(label: string, f: () => unknown | Promise<unknown>) {
  await f()
  await Bun.sleep(300)
  const held = await privateBytes()
  const heapHeld = heapStats().heapSize
  Bun.gc(true)
  await Bun.sleep(300)
  const live = await privateBytes()
  const heapLive = heapStats().heapSize
  rows.push(`${label.padEnd(24)} ${mb(held)} ${mb(live)} ${mb(live - last)} ${mb(heapHeld)} ${mb(heapLive)}`)
  last = live
}

await step("baseline (modules)", () => {})
const { configSchema } = await import("../../src/config/schema")
const ws = createWorkspace(root, {}, configSchema.parse({ editor: { highlightMaxBytes: Number(Bun.env.HL ?? 1_000_000) } }))
const tree = new TreeModel(root)
let h: Awaited<ReturnType<typeof renderApp>> | null = null
await step("app + tree", async () => {
  h = await renderApp(ws, { tree: <FileTree tree={tree} height={28} /> })
  await tree.load()
})
await step("ctrl+p index", () => tree.files())
await step(`open ${Bun.env.FILE ?? "big.ts"}`, async () => {
  await ws.buffers.open(Bun.env.FILE ?? "big.ts")
  await Bun.sleep(1500)
  await h!.setup.renderOnce()
})
await step("highlighter stopped", () => destroyTreeSitterClient())
const git = GitRepos.single(new GitStatus(root))
await step("git status", async () => {
  ws.git = git
  await git.start(60_000)
})
await step("AI terminal, 2 MB out", async () => {
  const term = new EmbeddedTerminalRenderable(h!.setup.renderer, { width: 80, height: 24, maxScrollback: 2_000_000 })
  const line = "\x1b[32m✓\x1b[0m Some typical AI output with a few words and \x1b[1mbold\x1b[0m bits in it, about 90 bytes\r\n"
  const chunk = line.repeat(1000)
  for (let i = 0; i < Math.ceil(2_000_000 / chunk.length); i++) term.write(chunk)
})

console.log(`${"step".padEnd(24)} ${"held".padStart(7)} ${"live".padStart(7)} ${"+live".padStart(7)} ${"heap".padStart(7)} ${"heapGC".padStart(7)}  (MB; private = RssAnon)`)
for (const r of rows) console.log(r)
git.stop()
h!.setup.renderer.destroy()
process.exit(0)
