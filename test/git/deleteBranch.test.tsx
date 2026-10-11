import { afterEach, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseKeypress } from "@opentui/core"
import { GitStatus } from "../../src/files/gitStatus"
import { keyToString } from "../../src/keymap/keys"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

const ENV = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" }
let h: Harness | null = null
let git: GitStatus | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  git?.stop()
  h = null
})
const sh = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...ENV, GIT_OPTIONAL_LOCKS: "0" } }).stdout.toString()
const branchList = (root: string) => sh(root, "branch", "--format=%(refname:short)").trim().split("\n").sort()
async function until(cond: () => boolean, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end && !cond(); ) {
    await Bun.sleep(30)
    await h?.setup.renderOnce()
  }
}

async function repoWithBranches() {
  const root = await fixture({ "a.ts": "a\n" })
  sh(root, "init", "-q", "-b", "main")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  sh(root, "branch", "merged-one") // nothing new: fully merged
  sh(root, "switch", "-q", "-c", "unmerged-one")
  writeFileSync(join(root, "b.ts"), "b\n")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "work only here")
  sh(root, "switch", "-q", "main")
  const ws = createWorkspace(root)
  git = new GitStatus(root)
  await git.start(60_000)
  ws.git = git
  h = await renderApp(ws, { tree: <text>TREE</text> })
  return { root, ws }
}

test("Delete a branch: merged ones go after one confirmation, unmerged ones need a second", async () => {
  const { root, ws } = await repoWithBranches()
  await h!.step(() => ws.ui.set({ modal: { kind: "branches", mode: "delete" } }))
  await until(() => h!.frame().includes("merged-one"))
  expect(h!.frame()).toContain("Delete branch")
  expect(h!.frame()).not.toContain("● main") // the current branch isn't offered
  // Fuzzy matching may rank either branch first for a query, so the test handles both orders.
  const pick = async (name: string) => {
    await h!.step(() => h!.keys.pressKey("u", { ctrl: true })) // clear the query
    for (let i = 0; i < 20; i++) await h!.step(() => h!.keys.pressBackspace())
    await h!.step(() => h!.keys.typeText(name))
    await until(() => h!.frame().includes(name))
  }
  await pick("merged-one")
  await h!.step(() => h!.keys.pressEnter())
  await until(() => h!.frame().includes("Delete branch merged-one? (y/n)") || h!.frame().includes("Delete branch unmerged-one? (y/n)"))
  const first = h!.frame().includes("Delete branch merged-one?") ? "merged-one" : "unmerged-one"
  await h!.step(() => h!.keys.pressKey("y"))
  if (first === "unmerged-one") {
    await until(() => h!.frame().includes("aren't merged anywhere"))
    await h!.step(() => h!.keys.pressKey("y"))
  }
  await until(() => !branchList(root).includes(first))
  expect(branchList(root)).not.toContain(first)

  const other = first === "merged-one" ? "unmerged-one" : "merged-one"
  await pick(other)
  await h!.step(() => h!.keys.pressEnter())
  await until(() => h!.frame().includes(`Delete branch ${other}? (y/n)`))
  await h!.step(() => h!.keys.pressKey("y"))
  if (other === "unmerged-one") {
    await until(() => h!.frame().includes("aren't merged anywhere"))
    expect(branchList(root)).toContain("unmerged-one") // not gone until the second yes
    await h!.step(() => h!.keys.pressKey("y"))
  }
  await until(() => !branchList(root).includes(other))
  expect(branchList(root)).toEqual(["main"])
})

test("Shift+Delete in the branch switcher deletes the selected branch, never the current one", async () => {
  const { root, ws } = await repoWithBranches()
  await h!.step(() => ws.ui.set({ modal: { kind: "branches" } }))
  await until(() => h!.frame().includes("● main"))
  await h!.step(() => h!.keys.typeText("main"))
  await until(() => !h!.frame().includes("merged-one"))
  await h!.step(() => h!.keys.pressKey("DELETE", { shift: true }))
  expect(h!.frame()).toContain("current branch")
  expect(branchList(root)).toContain("main")
})

test("Shift+Delete arrives from the terminal as shift+delete", () => {
  expect(keyToString(parseKeypress("\x1b[3;2~")!)).toBe("shift+delete")
})

test("with the mouse: the × on the hovered branch, or a right-click, deletes it", async () => {
  const { root, ws } = await repoWithBranches()
  await h!.step(() => ws.ui.set({ modal: { kind: "branches" } }))
  await until(() => h!.frame().includes("merged-one"))
  const row = h!.find("  merged-one")
  await h!.step(() => h!.mouse.moveTo(row.x + 4, row.y))
  await until(() => h!.frame().includes("× delete"))
  const x = h!.find("× delete")
  await h!.step(() => h!.mouse.click(x.x, x.y))
  await until(() => /Delete branch (un)?merged-one\? \(y\/n\)/.test(h!.frame()))
  const target = h!.frame().includes("Delete branch unmerged-one?") ? "unmerged-one" : "merged-one"
  await h!.step(() => h!.keys.pressKey("y"))
  if (target === "unmerged-one") {
    await until(() => h!.frame().includes("aren't merged anywhere"))
    await h!.step(() => h!.keys.pressKey("y"))
  }
  await until(() => !branchList(root).includes(target))
  expect(branchList(root)).not.toContain(target)

  const other = target === "merged-one" ? "unmerged-one" : "merged-one"
  await until(() => h!.frame().includes(other))
  const r = h!.find(other)
  await h!.step(() => h!.mouse.click(r.x, r.y, 2))
  await until(() => h!.frame().includes(`Delete branch ${other}? (y/n)`))
  expect(h!.frame()).toContain(`Delete branch ${other}? (y/n)`)
})
