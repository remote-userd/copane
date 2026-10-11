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
const sh = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...ENV } }).stdout.toString()
async function until(cond: () => boolean, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end && !cond(); ) {
    await Bun.sleep(30)
    await h?.setup.renderOnce()
  }
}
async function app(root: string, open?: string) {
  const ws = createWorkspace(root)
  git = new GitStatus(root)
  await git.start(50)
  ws.git = git
  if (open) await ws.buffers.open(open)
  h = await renderApp(ws, { tree: <text>TREE</text> })
  return ws
}

test("branch picker: create a branch from the query, then switch back", async () => {
  const root = await fixture({ "a.ts": "a\n" })
  sh(root, "init", "-q", "-b", "main")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  await app(root)
  await h!.step(() => h!.keys.pressKey("b", { ctrl: true, meta: true }))
  await until(() => h!.frame().includes("● main"))
  await h!.step(() => h!.keys.typeText("feature/x"))
  await until(() => h!.frame().includes('Create branch "feature/x"'))
  await h!.step(() => h!.keys.pressEnter())
  await until(() => sh(root, "branch", "--show-current").trim() === "feature/x")
  expect(sh(root, "branch", "--show-current").trim()).toBe("feature/x")
  await h!.step(() => h!.keys.pressKey("b", { ctrl: true, meta: true }))
  await until(() => h!.frame().includes("● feature/x"))
  await h!.step(() => h!.keys.typeText("main"))
  await h!.step(() => h!.keys.pressEnter())
  await until(() => sh(root, "branch", "--show-current").trim() === "main")
  expect(sh(root, "branch", "--show-current").trim()).toBe("main")
}, 20_000)

test("merge conflict: bar with count; Alt+3 keeps both sides; staging resolves it", async () => {
  const root = await fixture({ "a.ts": "start\nshared\nend\n" })
  sh(root, "init", "-q", "-b", "main")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  sh(root, "switch", "-qc", "other")
  writeFileSync(join(root, "a.ts"), "start\ntheirs\nend\n")
  sh(root, "commit", "-qam", "theirs")
  sh(root, "switch", "-q", "main")
  writeFileSync(join(root, "a.ts"), "start\nmine\nend\n")
  sh(root, "commit", "-qam", "mine")
  sh(root, "merge", "other") // conflicts
  const ws = await app(root, "a.ts")
  await until(() => h!.frame().includes("1 merge conflict"))
  expect(h!.frame()).toContain("Accept current (Alt+1)")
  const ta = ws.buffers.active!.textarea!
  ta.setCursor(1, 0)
  await h!.step(() => h!.keys.pressKey("3", { meta: true }))
  expect(ta.plainText).toBe("start\nmine\ntheirs\nend\n")
  await until(() => !h!.frame().includes("merge conflict"))
  expect(h!.frame()).not.toContain("merge conflict")
  ta.undo()
  expect(ta.plainText).toContain("<<<<<<<")
  ta.redo()
  await ws.buffers.save(ws.buffers.active!.id)
  // Stage it from Source Control: it leaves the conflict section.
  expect(git!.entries.some((e) => e.conflict)).toBe(true)
  await git!.repo!.stage([join(root, "a.ts")])
  await git!.afterChange()
  expect(git!.entries.some((e) => e.conflict)).toBe(false)
}, 20_000)
