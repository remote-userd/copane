import { afterEach, expect, spyOn, test } from "bun:test"
import { join } from "node:path"
import { Lexer } from "marked"
import { windowFocus } from "../../src/app/windowFocus"
import { GitStatus } from "../../src/files/gitStatus"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
  windowFocus.set({ focused: true })
})
const settle = async (ms = 80) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    await Bun.sleep(15)
    await h?.setup.renderOnce()
  }
}

test("a cursor move notifies cursor listeners only, not every store subscriber", async () => {
  const root = await fixture({ "a.ts": "one\ntwo\nthree\n" })
  const ws = createWorkspace(root)
  await ws.buffers.open(join(root, "a.ts"))
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await settle()
  let general = 0
  let cursor = 0
  const offA = ws.buffers.subscribe(() => general++)
  const offB = ws.buffers.subscribeCursor(() => cursor++)
  const ta = ws.buffers.active!.textarea!
  for (const row of [1, 2, 0]) {
    ta.setCursor(row, 0)
    ws.buffers.onCursorChange(ws.buffers.active!.id)
  }
  offA()
  offB()
  expect(cursor).toBe(3)
  expect(general).toBe(0)
  await settle()
  expect(h.frame()).toContain("Ln 1, Col 1") // the status bar still follows
})

test("moving the cursor in another tab doesn't re-parse an open Markdown preview", async () => {
  const root = await fixture({ "a.ts": "x\n".repeat(50), "notes.md": "# Title\n\n- one\n- two\n" })
  const ws = createWorkspace(root)
  ws.buffers.openPreview(join(root, "notes.md"))
  await ws.buffers.open(join(root, "a.ts"))
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await settle(150)
  const lex = spyOn(Lexer.prototype, "lex")
  const ta = ws.buffers.active!.textarea!
  for (let row = 1; row < 30; row++) {
    ta.setCursor(row, 0)
    ws.buffers.onCursorChange(ws.buffers.active!.id)
    await h.setup.renderOnce()
  }
  expect(lex).not.toHaveBeenCalled()
  lex.mockRestore()
})

test("git status isn't polled while the window is in the background", async () => {
  const root = await fixture({ "a.txt": "a" })
  Bun.spawnSync(["git", "init", "-q"], { cwd: root })
  const git = new GitStatus(root)
  await git.start(20)
  let polls = 0
  const original = (git as unknown as { gitFingerprint: () => Promise<string> }).gitFingerprint.bind(git)
  ;(git as unknown as { gitFingerprint: () => Promise<string> }).gitFingerprint = () => (polls++, original())
  windowFocus.set({ focused: false })
  await Bun.sleep(150)
  expect(polls).toBe(0)
  windowFocus.set({ focused: true })
  await Bun.sleep(150)
  expect(polls).toBeGreaterThan(0)
  git.stop()
})
