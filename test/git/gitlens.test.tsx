import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { GitStatus } from "../../src/files/gitStatus"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil } from "../helpers"

// Several waits on the UI and git per test: more room than the default 5 s.
setDefaultTimeout(15_000)

const ENV = { GIT_AUTHOR_NAME: "Ann Dev", GIT_AUTHOR_EMAIL: "a@d", GIT_COMMITTER_NAME: "Ann Dev", GIT_COMMITTER_EMAIL: "a@d", GIT_OPTIONAL_LOCKS: "0" }
let h: Harness | null = null
let git: GitStatus | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  git?.stop()
  h = null
})
const sh = (cwd: string, env: Record<string, string>, ...args: string[]) =>
  Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...ENV, ...env } }).stdout.toString()
const until = (cond: () => boolean | Promise<boolean>, ms = 4000) => waitUntil(cond, ms, () => h?.setup.renderOnce())

/** a.ts: line 1 by Ann ("Start"), line 2 by Bob ("Bob's line"). */
async function twoAuthors(config: object = {}) {
  const { configSchema } = await import("../../src/config/schema")
  const root = await fixture({ "a.ts": "const one = 1\nconst two = 2\n" })
  sh(root, {}, "init", "-q", "-b", "main")
  sh(root, {}, "add", ".")
  sh(root, {}, "commit", "-qm", "Start")
  writeFileSync(join(root, "a.ts"), "const one = 1\nconst TWO = 2\n")
  const bob = { GIT_AUTHOR_NAME: "Bob Lee", GIT_COMMITTER_NAME: "Bob Lee" }
  sh(root, bob, "commit", "-qam", "Bob's line")
  const ws = createWorkspace(root, {}, configSchema.parse(config))
  git = new GitStatus(root)
  await git.start(50)
  ws.git = git
  await ws.buffers.open("a.ts")
  h = await renderApp(ws, { tree: <text>TREE</text> })
  return { ws, root }
}
const moveTo = (ws: ReturnType<typeof createWorkspace>, row: number) => {
  ws.buffers.active!.textarea!.setCursor(row, 0)
  ws.buffers.onCursorChange(ws.buffers.active!.id)
}
const lineWith = (s: string) => h!.lines().find((l) => l.includes(s)) ?? ""

test("inline blame: the cursor line's author, age and summary after its end, and only there", async () => {
  const { ws } = await twoAuthors()
  moveTo(ws, 1)
  await until(() => lineWith("const TWO").includes("Bob Lee, just now • Bob's line"))
  expect(lineWith("const one")).not.toContain("Ann Dev")
  moveTo(ws, 0)
  await until(() => lineWith("const one").includes("Ann Dev, just now • Start"))
  expect(lineWith("const TWO")).not.toContain("Bob Lee")
})

test("file blame (Alt+B): each block's author, age and summary beside its lines; a click opens the commit", async () => {
  const { ws } = await twoAuthors()
  const { runCommand } = await import("../../src/keymap/commands")
  await runCommand(ws, "git.toggleFileBlame")
  await until(() => /Ann Dev\s+now\s+Start.*const one/.test(h!.frame()))
  expect(lineWith("const TWO")).toMatch(/Bob Lee\s+now\s+Bob's line.*const TWO/)
  const at = h!.find("Bob Lee")
  await h!.step(() => h!.mouse.click(at.x, at.y))
  // The commit's details come from git a moment after the dialog opens.
  await until(() => h!.frame().includes("Author: Bob Lee"))
  await h!.step(() => h!.keys.pressEscape())
  await runCommand(ws, "git.toggleFileBlame")
  await until(() => !h!.frame().includes("Bob Lee"))
})

test("file blame follows scrolling: the top row always names its block", async () => {
  const root = await fixture({ "a.ts": Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n") + "\n" })
  sh(root, {}, "init", "-q", "-b", "main")
  sh(root, {}, "add", ".")
  sh(root, {}, "commit", "-qm", "Many lines")
  const ws = createWorkspace(root)
  git = new GitStatus(root)
  await git.start(50)
  ws.git = git
  await ws.buffers.open("a.ts")
  h = await renderApp(ws, { tree: <text>TREE</text> })
  ws.ui.set({ fileBlame: true })
  await until(() => lineWith("line 0").includes("Ann Dev"))
  ws.buffers.active!.textarea!.setCursor(150, 0)
  ws.buffers.onCursorChange(ws.buffers.active!.id)
  await until(() => h!.lines().some((l) => /Ann Dev.*line 1[2-4]\d\b/.test(l)))
  expect(lineWith("line 0")).toBe("")
})

test("file history rows show each commit's author and age", async () => {
  const { ws } = await twoAuthors()
  const { runCommand } = await import("../../src/keymap/commands")
  await runCommand(ws, "git.fileHistory")
  await until(() => /Bob Lee\s+now Bob's line/.test(h!.frame()))
  expect(h!.frame()).toMatch(/Ann Dev\s+now Start/)
})

test("inline blame can be turned off (git.inlineBlame: false)", async () => {
  const { ws } = await twoAuthors({ git: { inlineBlame: false } })
  moveTo(ws, 1)
  // The status bar still has it; the line does not.
  await until(() => h!.lines().at(-2)!.includes("Bob Lee · just now"))
  expect(lineWith("const TWO")).not.toContain("Bob Lee")
})
