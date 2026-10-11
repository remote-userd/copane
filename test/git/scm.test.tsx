import { afterEach, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { GitStatus } from "../../src/files/gitStatus"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

const ENV = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" }
let h: Harness | null = null
let git: GitStatus | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  git?.stop()
  h = null
})

function sh(cwd: string, ...args: string[]) {
  return Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...ENV } }).stdout.toString()
}

// Generous: each step runs real git, which is slow on loaded CI machines (macOS especially).
async function until(cond: () => boolean, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end && !cond(); ) {
    await Bun.sleep(25)
    await h?.setup.renderOnce()
  }
}

async function setup() {
  const root = await fixture({ "a.ts": "one\ntwo\n", "b.ts": "keep\n" })
  sh(root, "init", "-q", "-b", "main")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  writeFileSync(join(root, "a.ts"), "one\nTWO by ai\n")
  writeFileSync(join(root, "new.ts"), "fresh\n")
  Object.assign(process.env, ENV)
  const ws = createWorkspace(root)
  git = new GitStatus(root)
  await git.start(50)
  ws.git = git
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await h.step(() => h!.keys.pressKey("d", { ctrl: true, meta: true }))
  await until(() => h!.frame().includes("+TWO by ai"))
  return { ws, root }
}

test("panel lists changes with a diff; Space stages; message + Enter commits", async () => {
  const { root } = await setup()
  const f = h!.frame()
  expect(f).toContain("Source control")
  expect(f).toContain("Changes (2)")
  expect(f).toContain("a.ts")
  expect(f).toContain("+TWO by ai")
  // The list has focus when nothing is staged; stage a.ts.
  await h!.step(() => h!.keys.pressKey(" "))
  await until(() => h!.frame().includes("Staged (1)"))
  expect(h!.frame()).toContain("Staged (1)")
  // Write a message and commit with Enter.
  await h!.step(() => h!.keys.pressKey("c"))
  await h!.step(() => h!.keys.typeText("Update a"))
  await h!.step(() => h!.keys.pressEnter())
  await until(() => sh(root, "log", "--format=%s").startsWith("Update a"))
  expect(sh(root, "log", "--format=%s").split("\n")[0]).toBe("Update a")
  await until(() => !h!.frame().includes("Staged ("))
  expect(h!.frame()).toContain("Changes (1)") // new.ts is still untracked
})

test("commit with nothing staged offers to stage all; y commits everything", async () => {
  const { root } = await setup()
  await h!.step(() => h!.keys.pressKey("c"))
  await h!.step(() => h!.keys.typeText("All of it"))
  await h!.step(() => h!.keys.pressEnter())
  await until(() => h!.frame().includes("Stage all changes and commit?"))
  await h!.step(() => h!.keys.pressKey("y"))
  await until(() => sh(root, "status", "--porcelain") === "")
  expect(sh(root, "status", "--porcelain")).toBe("")
  await until(() => h!.frame().includes("No changes"))
  expect(h!.frame()).toContain("No changes")
  expect(h!.frame()).toContain("Committed")
})

test("r + y reverts the selected file", async () => {
  const { root } = await setup()
  await h!.step(() => h!.keys.pressKey("r"))
  expect(h!.frame()).toContain("Discard all changes to a.ts?")
  await h!.step(() => h!.keys.pressKey("y"))
  await until(() => !sh(root, "status", "--porcelain").includes("a.ts"))
  expect(Bun.file(join(root, "a.ts")).text()).resolves.toBe("one\ntwo\n")
})

test("push without a remote explains it", async () => {
  await setup()
  await h!.step(() => h!.keys.pressKey("p", { shift: true }))
  await until(() => h!.frame().includes("No remote configured"))
  expect(h!.frame()).toContain("No remote configured")
})

test("AI message: asks the configured claude with the staged diff and fills the message", async () => {
  const { aiCommitMessage } = await import("../../src/git/SourceControlPanel")
  const { configSchema } = await import("../../src/config/schema")
  const { GitRepo } = await import("../../src/git/repo")
  const root = await fixture({ "a.ts": "one\n" })
  sh(root, "init", "-q", "-b", "main")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  writeFileSync(join(root, "a.ts"), "two\n")
  sh(root, "add", ".")
  // A stand-in "claude": checks it got -p and the diff on stdin, prints a message.
  const bin = join(root, ".bin")
  Bun.spawnSync(["mkdir", "-p", bin])
  writeFileSync(join(bin, "claude"), '#!/bin/sh\n[ "$1" = "-p" ] || exit 2\ngrep -q "+two" || exit 3\necho "Change a to two"\n')
  Bun.spawnSync(["chmod", "+x", join(bin, "claude")])
  const ws = createWorkspace(root, {}, configSchema.parse({ ai: { command: join(bin, "claude") } }))
  ws.git = { repo: new GitRepo(root) } as never
  expect(await aiCommitMessage(ws)).toBe("Change a to two")
  const other = createWorkspace(root, {}, configSchema.parse({ ai: { command: "codex" } }))
  other.git = ws.git
  expect(await aiCommitMessage(other)).toEqual({ error: "AI messages need claude as ai.command (now codex)" })
})
