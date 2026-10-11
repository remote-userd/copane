import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { TurnLog } from "../../src/ai/turns"
import { GitRepo } from "../../src/git/repo"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil, GIT_ENV } from "../helpers"

// Several waits on the UI and git per test: more room than the default 5 s.
setDefaultTimeout(15_000)

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})
const until = (cond: () => boolean | Promise<boolean>, ms = 3000) => waitUntil(cond, ms, () => h?.setup.renderOnce())
const ENV = GIT_ENV

test("Ctrl+Alt+Z lists the turn, shows its changes, and u undoes it", async () => {
  const root = await fixture({ "cart.ts": "let total = 0\nfor (let i = 1; i < n; i++) {}\nexport { total }\n" })
  for (const args of [["init", "-q"], ["add", "."], ["commit", "-qm", "init"]]) Bun.spawnSync(["git", ...args], { cwd: root, env: ENV })
  const ws = createWorkspace(root)
  const git = new GitRepo(root)
  ws.turns = new TurnLog(root, () => git)
  const cart = join(root, "cart.ts")
  await ws.turns.begin("the total is wrong, fix it")
  writeFileSync(cart, "let total = 0\nfor (let i = 0; i < n; i++) {}\nexport { total }\n")
  await ws.turns.fileChanged(cart)
  await ws.turns.end()

  h = await renderApp(ws, { tree: <text>TREE</text> }, { width: 140, height: 30 })
  await h.step(() => h!.keys.pressKey("z", { ctrl: true, meta: true }))
  await until(() => h!.frame().includes("+ for (let i = 0"))
  const f = h.frame()
  expect(f).toMatch(/1 file \+1 −1 the total is wrong/)
  expect(f).toContain("cart.ts")
  expect(f).toContain("- for (let i = 1; i < n; i++) {}")
  expect(f).toContain("+ for (let i = 0; i < n; i++) {}")

  await h.step(() => h!.keys.pressKey("u"))
  await until(() => readFileSync(cart, "utf8").includes("i = 1"))
  expect(readFileSync(cart, "utf8")).toBe("let total = 0\nfor (let i = 1; i < n; i++) {}\nexport { total }\n")
  await until(() => h!.frame().includes("No difference from before this turn"))
  expect(h.frame()).toContain("No difference from before this turn")
})

test("with no turns yet, it explains what will appear", async () => {
  const ws = createWorkspace(await fixture({}))
  ws.turns = new TurnLog(ws.root, () => null)
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await h.step(() => ws.ui.set({ modal: { kind: "turns" } }))
  expect(h.frame()).toContain("No AI changes yet")
})
