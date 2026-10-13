import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { TerminalPane, worktreeFor, type AiConfig } from "../../src/ai/TerminalPane"
import type { MenuItem } from "../../src/app/state"
import { GitStatus } from "../../src/files/gitStatus"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil, GIT_ENV } from "../helpers"

// Several waits on the UI and git per test: more room than the default 5 s.
setDefaultTimeout(15_000)

let h: Harness | null = null
let git: GitStatus | null = null
afterEach(() => {
  h?.ws.ai?.kill()
  h?.setup.renderer.destroy()
  git?.stop()
  h = null
})
// Agents start, stop and git worktrees change here: slow under a loaded machine.
const until = (cond: () => boolean | Promise<boolean>, ms = 8000) => waitUntil(cond, ms, () => h?.setup.renderOnce())
const ENV = GIT_ENV

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
  const branch = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: wt.path, env: ENV }).stdout.toString().trim()
  expect(branch).toBe("copane/second-1")

  await h!.step(() => ws.agents!.closeActive())
  const modal = ws.ui.get().modal
  expect(modal?.kind).toBe("confirm")
  if (modal?.kind !== "confirm") return
  await h!.step(() => modal.options.find((o) => o.key === "r")!.run())
  await until(() => !existsSync(wt.path))
  expect(existsSync(wt.path)).toBe(false)
  expect(Bun.spawnSync(["git", "branch", "--list", "copane/second-1"], { cwd: root, env: ENV }).stdout.toString()).toContain("copane/second-1")
})

test("worktree paths sit beside the project, with a branch per agent", () => {
  expect(worktreeFor("/work/app", "Claude Code", 2)).toEqual({ path: "/work/app-claude-code-2", branch: "copane/claude-code-2", cwd: "/work/app-claude-code-2" })
  // Opened in a subfolder of the repo: the worktree goes beside the repo, the agent starts in the same subfolder.
  expect(worktreeFor("/work/mono/pkg/app", "claude", 1, "/work/mono")).toEqual({
    path: "/work/mono-claude-1",
    branch: "copane/claude-1",
    cwd: "/work/mono-claude-1/pkg/app",
  })
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

async function worktreeAgent() {
  const root = await fixture({ "a.txt": "a\n", "b.txt": "b\n" })
  for (const args of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-qm", "init"]]) Bun.spawnSync(["git", ...args], { cwd: root, env: ENV })
  const ws = await pane(root)
  git = new GitStatus(root)
  await git.start(60_000)
  ws.git = git
  await h!.step(() => ws.agents!.openMenu())
  await h!.step(() => menuItem(ws, "New second in a git worktree").run())
  const wt = worktreeFor(root, "second", 1)
  await until(() => h!.frame().includes("second-agent-ready"))
  // The agent's work: one commit, one uncommitted edit, one new file.
  writeFileSync(join(wt.path, "a.txt"), "a by agent\n")
  Bun.spawnSync(["git", "commit", "-qam", "agent: a"], { cwd: wt.path, env: ENV })
  writeFileSync(join(wt.path, "b.txt"), "b by agent\n")
  writeFileSync(join(wt.path, "new.txt"), "new\n")
  return { root, ws, wt }
}
const gitOut = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd, env: ENV }).stdout.toString()

test("review & merge a worktree agent: its files and diffs, merge, then clean up", async () => {
  const { root, ws, wt } = await worktreeAgent()
  ws.agents!.recount(ws.agents!.activeId())
  await until(() => h!.frame().includes("COPANE/SECOND-1 · 3"))
  expect(h!.frame()).toContain("COPANE/SECOND-1 · 3") // the tab counts its changed files

  const { runCommand } = await import("../../src/keymap/commands")
  await h!.step(() => runCommand(ws, "ai.mergeAgent"))
  await until(() => h!.frame().includes("new.txt") && h!.frame().includes("+a by agent"))
  const f = h!.frame()
  expect(f).toContain("Review & merge second (copane/second-1) into main")
  for (const row of ["M a.txt", "M b.txt", "A new.txt"]) expect(f).toContain(row)
  expect(f).toContain("+a by agent") // the first file's diff
  await h!.step(() => h!.keys.pressArrow("down"))
  await until(() => h!.frame().includes("+b by agent"))

  await h!.step(() => h!.keys.pressKey("m"))
  await until(() => ws.ui.get().modal?.kind === "confirm")
  expect(await Bun.file(join(root, "b.txt")).text()).toBe("b by agent\n")
  expect(await Bun.file(join(root, "new.txt")).text()).toBe("new\n")
  expect(gitOut(root, "log", "--oneline", "-1")).toContain("Merge branch 'copane/second-1'")
  const modal = ws.ui.get().modal
  if (modal?.kind !== "confirm") throw new Error("no confirm")
  await h!.step(() => modal.options.find((o) => o.key === "r")!.run())
  await until(() => !existsSync(wt.path))
  expect(existsSync(wt.path)).toBe(false)
  // The branch goes after the worktree folder: wait for it too.
  await until(() => gitOut(root, "branch", "--list", "copane/second-1") === "")
  expect(gitOut(root, "branch", "--list", "copane/second-1")).toBe("")
  await until(() => !h!.frame().includes("SECOND"))
  expect(h!.frame()).not.toContain("SECOND ⎇")
})

test("discarding a worktree agent's work removes its worktree, branch and tab", async () => {
  const { root, ws, wt } = await worktreeAgent()
  await h!.step(() => ws.agents!.closeActive())
  const modal = ws.ui.get().modal
  if (modal?.kind !== "confirm") throw new Error("no confirm")
  expect(modal.options.map((o) => o.label)).toContain("Review & merge first")
  await h!.step(() => modal.options.find((o) => o.key === "m")!.run())
  await until(() => h!.frame().includes("A new.txt"))
  await h!.step(() => h!.keys.pressKey("d"))
  await until(() => h!.frame().includes("Throw away 3 changed files"))
  await h!.step(() => h!.keys.pressKey("y"))
  await until(() => !existsSync(wt.path))
  expect(existsSync(wt.path)).toBe(false)
  // The branch goes after the worktree folder: wait for it too.
  await until(() => gitOut(root, "branch", "--list", "copane/second-1") === "")
  expect(gitOut(root, "branch", "--list", "copane/second-1")).toBe("")
  expect(await Bun.file(join(root, "b.txt")).text()).toBe("b\n") // nothing came back
  await until(() => !h!.frame().includes("SECOND ⎇"))
  expect(h!.frame()).not.toContain("SECOND ⎇")
})

test("a new worktree agent skips a number whose branch was kept after its worktree was removed", async () => {
  const root = await fixture({ "a.txt": "a" })
  for (const args of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-qm", "init"], ["branch", "copane/second-1"]]) Bun.spawnSync(["git", ...args], { cwd: root, env: ENV })
  const ws = await pane(root)
  git = new GitStatus(root)
  await git.start(60_000)
  ws.git = git
  await h!.step(() => ws.agents!.openMenu())
  await h!.step(() => menuItem(ws, "New second in a git worktree").run())
  await until(() => h!.frame().includes("second-agent-ready"))
  expect(h!.frame()).toContain("COPANE/SECOND-2")
  expect(existsSync(worktreeFor(root, "second", 2).path)).toBe(true)
})

test("a CLI that opens with a question brings focus to the AI pane, even when it then goes quiet", async () => {
  const ws = createWorkspace(await fixture({ "a.txt": "a" }), { focus: "editor" })
  const asks: AiConfig = {
    command: "/bin/sh",
    // Lots of output first (scans are throttled), then the question as the very last thing.
    args: ["-c", "for i in $(seq 1 200); do echo line $i; done; printf 'Do you trust this folder?'; exec cat"],
    maxScrollbackBytes: 100_000,
    notify: "off",
    agents: [],
  }
  h = await renderApp(ws, { tree: <text>TREE</text>, ai: <TerminalPane config={asks} /> }, { width: 140, height: 24 })
  await until(() => ws.ui.get().focus === "ai")
  expect(ws.ui.get().focus).toBe("ai")
  expect(ws.ui.get().notice?.text).toContain("asking a question")
})
