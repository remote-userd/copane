import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { GitStatus } from "../../src/files/gitStatus"
import { fixture } from "../helpers"

test("status with 5,000 untracked files (a build folder not in .gitignore) stays quick", async () => {
  const root = await fixture({ "a.ts": "a\n" })
  Bun.spawnSync(["git", "init", "-q"], { cwd: root })
  for (let d = 0; d < 50; d++) {
    mkdirSync(join(root, `build/d${d}`), { recursive: true })
    for (let i = 0; i < 100; i++) writeFileSync(join(root, `build/d${d}/f${i}.js`), "x")
  }
  const gs = new GitStatus(root)
  await gs.start(60_000)
  expect(gs.entries.length).toBe(5001)
  expect(gs.dirMark(join(root, "build/d7"))).toBe("U")
  // The parse runs on the UI thread after every batch of file changes: time a full reload.
  const runs: number[] = []
  for (let k = 0; k < 5; k++) {
    writeFileSync(join(root, "a.ts"), `a${k}\n`)
    const t = performance.now()
    await gs.afterChange()
    runs.push(performance.now() - t)
  }
  runs.sort((a, b) => a - b)
  // Measured ~20 ms here (git itself ~10 ms); the budget leaves room for slow CI machines.
  expect(runs[2]!).toBeLessThan(250)
  gs.stop()
})
