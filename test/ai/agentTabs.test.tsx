import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { TerminalPane, worktreeFor, type AiConfig } from "../../src/ai/TerminalPane"
import type { MenuItem } from "../../src/app/state"
import { GitStatus } from "../../src/files/gitStatus"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
let git: GitStatus | null = null
afterEach(() => {
  h?.ws.ai?.kill()
  h?.setup.renderer.destroy()
  git?.stop()
  h = null
})
async function until(cond: () => boolean, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end && !cond(); ) {
    await Bun.sleep(30)
    await h?.setup.renderOnce()
  }
}
const ENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" }

const config = (): AiConfig => ({
  command: "/bin/sh",
  args: ["-c", "echo first-agent-ready; exec cat"],
  maxScrollbackBytes: 100_000,
  notify: "off",
  agents: [{ name: "second", command: "/bin/sh", args: ["-c", "echo second-agent-ready; exec cat"] }],
})

async function pane(root: string) {
  const ws = createWorkspace(root)
  h = await renderApp(ws, { tree: <text>TREE</text>, ai: <TerminalPane config={config()} /> }, { width: 140, height: 24 })
  await until(() => h!.frame().includes("first-agent-ready"))
  return ws
}
/** A menu item; running it closes the menu first, as a click on it does. */
const menuItem = (ws: ReturnType<typeof createWorkspace>, label: string) => {
  const modal = ws.ui.get().modal
  if (modal?.kind !== "menu") throw new Error("no menu open")
  const item = modal.items.find((i: MenuItem) => i.label === label)!
  return { ...item, run: () => (ws.ui.set({ modal: null }), item.run()) }
}

test("a second agent opens in its own tab; text goes to the visible tab; tabs switch and close", async () => {
  const ws = await pane(await fixture({ "a.txt": "a" }))
  await h!.step(() => ws.agents!.openMenu())
  expect(menuItem(ws, "New second in a git worktree").disabled).toBe(true) // not a git repo
  await h!.step(() => menuItem(ws, "New second").run())
  await until(() => h!.frame().includes("second-agent-ready"))
  expect(h!.frame()).toContain("SECOND")
  expect(h!.frame()).not.toContain("first-agent-ready") // the first tab is hidden, still running

  await h!.step(() => ws.ai!.type("hello-to-second"))
  await until(() => h!.frame().includes("hello-to-second"))
  await h!.step(() => ws.agents!.cycle(1))
  await until(() => h!.frame().includes("first-agent-ready"))
  expect(h!.frame()).not.toContain("hello-to-second")
  await h!.step(() => ws.ai!.type("hello-to-first"))
  await until(() => h!.frame().includes("hello-to-first"))

  await h!.step(() => ws.agents!.closeActive())
  await until(() => h!.frame().includes("second-agent-ready"))
  expect(h!.frame()).toContain("hello-to-second")
  await h!.step(() => ws.agents!.closeActive())
  expect(ws.ui.get().notice?.text).toContain("only agent")
})

test("an agent in a git worktree works on its own branch; closing can remove the worktree", async () => {
  const root = await fixture({ "a.txt": "a" })
  for (const args of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-qm", "init"]]) Bun.spawnSync(["git", ...args], { cwd: root, env: ENV })
  const ws = await pane(root)
  git = new GitStatus(root)
  await git.start(60_000)
  ws.git = git
  await h!.step(() => ws.agents!.openMenu())
  await h!.step(() => menuItem(ws, "New second in a git worktree").run())
  const wt = worktreeFor(root, "second", 1)
  await until(() => h!.frame().includes("second-agent-ready"))
  expect(existsSync(join(wt.path, "a.txt"))).toBe(true)
  expect(h!.frame()).toContain("SECOND ⎇ COPANE/SECOND-1")
  const branch = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: wt.path }).stdout.toString().trim()
  expect(branch).toBe("copane/second-1")

  await h!.step(() => ws.agents!.closeActive())
  const modal = ws.ui.get().modal
  expect(modal?.kind).toBe("confirm")
  if (modal?.kind !== "confirm") return
  await h!.step(() => modal.options.find((o) => o.key === "r")!.run())
  await until(() => !existsSync(wt.path))
  expect(existsSync(wt.path)).toBe(false)
  expect(Bun.spawnSync(["git", "branch", "--list", "copane/second-1"], { cwd: root }).stdout.toString()).toContain("copane/second-1")
})

test("worktree paths sit beside the project, with a branch per agent", () => {
  expect(worktreeFor("/work/app", "Claude Code", 2)).toEqual({ path: "/work/app-claude-code-2", branch: "copane/claude-code-2" })
})

test("× on a tab closes it, and so does a middle-click; a single tab has neither", async () => {
  const ws = await pane(await fixture({ "a.txt": "a" }))
  expect(h!.frame()).not.toContain("×")
  await h!.step(() => ws.agents!.openMenu())
  await h!.step(() => menuItem(ws, "New second").run())
  await until(() => h!.frame().includes("second-agent-ready"))
  const x = h!.findAt("×", 60) // the first tab's ×, in the AI pane's header
  await h!.step(() => h!.mouse.click(x.x, x.y))
  await until(() => !h!.frame().includes("×"))
  expect(h!.frame()).not.toContain("SH ") // the first tab (/bin/sh) is gone
  expect(h!.frame()).toContain("SECOND")
  await h!.step(() => ws.agents!.openMenu())
  await h!.step(() => menuItem(ws, "New second").run())
  await until(() => h!.frame().includes("SECOND 2"))
  const tab = h!.find("SECOND 2")
  await h!.step(() => h!.mouse.click(tab.x, tab.y, 1))
  await until(() => !h!.frame().includes("SECOND 2"))
  expect(h!.frame()).not.toContain("SECOND 2")
})
