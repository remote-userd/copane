/**
 * Typing latency in a big file inside the full app (editor, gutter, git markers, status bar), with
 * realistic gaps between keys so the work after each pause (highlighting, markers…) runs too.
 */
import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { App } from "../../src/app/App"
import { createWorkspace, WorkspaceContext } from "../../src/app/workspace"
import { GitStatus } from "../../src/files/gitStatus"
import { fixture } from "../helpers"

const LINES = 11_000
const big = Array.from({ length: LINES }, (_, i) => `const value${i} = compute(${i}) // line ${i}`).join("\n")

async function session(keys: number) {
  const root = await fixture({})
  writeFileSync(join(root, "big.ts"), big)
  for (const args of [["init", "-q"], ["add", "."], ["commit", "-qm", "i"]]) Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root })
  const ws = createWorkspace(root)
  const git = new GitStatus(root)
  await git.start(60_000)
  ws.git = git
  const setup = await testRender(
    <WorkspaceContext.Provider value={ws}>
      <App slots={{ tree: <text>T</text> }} />
    </WorkspaceContext.Provider>,
    { width: 160, height: 40, exitOnCtrlC: false },
  )
  await ws.buffers.open(join(root, "big.ts"))
  ws.ui.set({ focus: "editor" })
  for (let i = 0; i < 30; i++) (await Bun.sleep(20), await setup.renderOnce())
  ws.buffers.active!.textarea!.setCursor(5000, 10)
  const lat: number[] = []
  let busy = 0 // main-thread time spent in frames between keys (the deferred passes land there)
  for (let i = 0; i < keys; i++) {
    const t0 = performance.now()
    setup.mockInput.typeText("x")
    await setup.renderOnce()
    lat.push(performance.now() - t0)
    for (let j = 0; j < 4; j++) {
      await Bun.sleep(20)
      const f0 = performance.now()
      await setup.renderOnce()
      busy += performance.now() - f0
    }
  }
  git.stop()
  setup.renderer.destroy()
  lat.sort((a, b) => a - b)
  return { median: lat[Math.floor(keys / 2)]!, p90: lat[Math.floor(keys * 0.9)]!, max: lat[keys - 1]!, busyPerKey: busy / keys }
}

test("typing in an 11,000-line file", async () => {
  const r = await session(40)
  console.log(`TYPING median ${r.median.toFixed(2)} ms | p90 ${r.p90.toFixed(2)} | max ${r.max.toFixed(2)} | background per key ${r.busyPerKey.toFixed(2)} ms`)
  expect(r.median).toBeGreaterThan(0)
}, 60_000)
