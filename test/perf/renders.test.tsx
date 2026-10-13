/**
 * Render budget: how many React commits (and how much render time) a cursor move, a keystroke
 * and a stream of AI output cost. Prints the numbers; the expectations guard against regressions.
 */
import { afterEach, expect, test } from "bun:test"
import { Profiler } from "react"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { App } from "../../src/app/App"
import { TerminalPane } from "../../src/ai/TerminalPane"
import { createWorkspace, WorkspaceContext } from "../../src/app/workspace"
import { fixture, captureFrame } from "../helpers"

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

const stats = { commits: 0, ms: 0 }
const reset = () => Object.assign(stats, { commits: 0, ms: 0 })

async function app(files: Record<string, string>, ai?: React.ReactNode) {
  const root = await fixture(files)
  const ws = createWorkspace(root)
  const setup = await testRender(
    <Profiler id="app" onRender={(_id, _phase, actual) => ((stats.commits += 1), (stats.ms += actual))}>
      <WorkspaceContext.Provider value={ws}>
        <App slots={{ tree: <text>TREE</text>, ai }} />
      </WorkspaceContext.Provider>
    </Profiler>,
    { width: 160, height: 40, exitOnCtrlC: false },
  )
  cleanup = () => {
    ws.ai?.kill()
    setup.renderer.destroy()
  }
  const settle = async (ms = 60) => {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      await Bun.sleep(15)
      await setup.renderOnce()
    }
  }
  return { root, ws, setup, settle }
}

const big = Array.from({ length: 11_000 }, (_, i) => `const value${i} = compute(${i}) // line ${i}`).join("\n")
const md = "# Notes\n\n" + Array.from({ length: 200 }, (_, i) => `- item **${i}** with \`code\` and a [link](https://x.y/${i})`).join("\n")

test("cursor moves and typing in a big file, with a Markdown preview open", async () => {
  const { root, ws, setup, settle } = await app({ "big.ts": big, "notes.md": md })
  ws.buffers.openPreview(join(root, "notes.md"))
  await ws.buffers.open(join(root, "big.ts"))
  ws.ui.set({ focus: "editor" })
  await settle(400)

  reset()
  const id = ws.buffers.active!.id
  for (let i = 0; i < 50; i++) {
    setup.mockInput.pressArrow("down")
    // The app reports each move to the store from the editor's cursor event, which the headless
    // renderer doesn't fire for key presses; make the same call here.
    ws.buffers.onCursorChange(id)
    await setup.renderOnce()
  }
  await settle()
  const arrows = { ...stats }
  // The status bar follows the cursor.
  expect(captureFrame(setup)).toContain("Ln 51, Col 1")

  reset()
  for (let i = 0; i < 50; i++) {
    setup.mockInput.typeText("x")
    await setup.renderOnce()
  }
  await settle()
  const typing = { ...stats }

  console.log(`RENDER arrows: ${arrows.commits} commits, ${arrows.ms.toFixed(0)} ms | typing: ${typing.commits} commits, ${typing.ms.toFixed(0)} ms`)
  expect(arrows.commits).toBeGreaterThan(0)
}, 30_000)

test("a stream of AI output", async () => {
  const pane = (
    <TerminalPane
      config={{ command: "/bin/sh", args: ["-c", "for i in $(seq 1 400); do echo chunk $i; sleep 0.005; done; exec cat"], maxScrollbackBytes: 100_000, notify: "off" }}
    />
  )
  const { settle } = await app({ "a.ts": "a\n" }, pane)
  await settle(100)
  reset()
  await settle(2500)
  console.log(`RENDER ai stream: ${stats.commits} commits, ${stats.ms.toFixed(0)} ms`)
  // ~400 chunks of output: the pane re-renders for the spinner's ticks, not per chunk (was ~300).
  expect(stats.commits).toBeGreaterThan(0)
  expect(stats.commits).toBeLessThan(80)
}, 30_000)
