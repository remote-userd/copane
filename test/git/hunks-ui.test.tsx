import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { GitStatus } from "../../src/files/gitStatus"
import { GitRepos } from "../../src/git/repos"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil, GIT_ENV } from "../helpers"

// Several waits on the UI and git per test: more room than the default 5 s.
setDefaultTimeout(15_000)

const ENV = GIT_ENV
let h: Harness | null = null
let git: GitStatus | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  git?.stop()
  h = null
})
const sh = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...ENV, GIT_OPTIONAL_LOCKS: "0" },
  }).stdout.toString()
const until = (cond: () => boolean | Promise<boolean>, ms = 3000) => waitUntil(cond, ms, () => h?.setup.renderOnce())

test("Alt+H peeks a change; s stages only that hunk; r reverts; Alt+F5 moves between changes", async () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)
  const root = await fixture({ "a.txt": lines.join("\n") + "\n" })
  sh(root, "init", "-q", "-b", "main")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  const changed = [...lines]
  changed[2] = "line 3 CHANGED"
  changed[15] = "line 16 CHANGED"
  writeFileSync(join(root, "a.txt"), changed.join("\n") + "\n")
  const ws = createWorkspace(root)
  git = new GitStatus(root)
  await git.start(50)
  ws.git = GitRepos.single(git)
  await ws.buffers.open("a.txt")
  h = await renderApp(ws, { tree: <text>TREE</text> })
  const ta = ws.buffers.active!.textarea!
  await until(() => (h!.lines().find((l) => l.includes("line 3 CHANGED")) ?? "").includes("▎"))

  // Alt+F5 from the top goes to the first change, then the second.
  ta.setCursor(0, 0)
  await h.step(() => h!.keys.pressKey("\x1b[15;3~"))
  await until(() => ta.logicalCursor.row === 2)
  expect(ta.logicalCursor.row).toBe(2)
  await h.step(() => h!.keys.pressKey("\x1b[15;3~"))
  await until(() => ta.logicalCursor.row === 15)
  expect(ta.logicalCursor.row).toBe(15)

  // Peek the second change and stage it.
  await h.step(() => h!.keys.pressKey("h", { meta: true }))
  await until(() => h!.frame().includes("Change 2 of 2"))
  expect(h.frame()).toContain("- line 16")
  expect(h.frame()).toContain("+ line 16 CHANGED")
  await h.step(() => h!.keys.pressKey("s"))
  await until(() => sh(root, "diff", "--cached").includes("+line 16 CHANGED"))
  const staged = sh(root, "diff", "--cached")
  expect(staged).toContain("+line 16 CHANGED")
  expect(staged).not.toContain("line 3 CHANGED")
  expect(sh(root, "diff")).toContain("+line 3 CHANGED") // the other hunk is still unstaged
  // The staged line loses its marker; the other keeps it.
  await until(() => !(h!.lines().find((l) => l.includes("line 16 CHANGED")) ?? "").includes("▎"))
  expect(h.lines().find((l) => l.includes("line 16 CHANGED"))).not.toContain("▎")
  expect(h.lines().find((l) => l.includes("line 3 CHANGED"))).toContain("▎")

  // Revert the first change from its peek: one undo step.
  ta.setCursor(2, 0)
  await h.step(() => h!.keys.pressKey("h", { meta: true }))
  await until(() => h!.frame().includes("Change 1 of 1"))
  await h.step(() => h!.keys.pressKey("r"))
  await until(() => ta.plainText.split("\n")[2] === "line 3")
  expect(ta.plainText.split("\n")[2]).toBe("line 3")
  ta.undo()
  expect(ta.plainText.split("\n")[2]).toBe("line 3 CHANGED")
})
