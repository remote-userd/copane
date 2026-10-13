import { expect, test } from "bun:test"
import { symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { GitStatus, parsePorcelain } from "../../src/files/gitStatus"
import { fixture } from "../helpers"

test("parsePorcelain maps XY codes to marks, skipping rename sources", () => {
  const out = [" M src/a.ts", "M  src/b.ts", "A  new.ts", "?? notes.md", " D gone.ts", "R  to.ts", "from.ts", "UU conflict.ts", "AA both.ts", ""].join("\0")
  const m = parsePorcelain(out, "/repo")
  expect(Object.fromEntries(m)).toEqual({
    "/repo/src/a.ts": "M",
    "/repo/src/b.ts": "M",
    "/repo/new.ts": "A",
    "/repo/notes.md": "U",
    "/repo/gone.ts": "D",
    "/repo/to.ts": "R",
    "/repo/conflict.ts": "!",
    "/repo/both.ts": "!",
  })
})

function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } })
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
}

test("GitStatus marks files and tints folders in a real repo", async () => {
  const root = await fixture({ "src/a.ts": "a", "src/deep/b.ts": "b", "README.md": "r" })
  git(root, "init", "-q")
  git(root, "add", ".")
  git(root, "commit", "-qm", "init")
  writeFileSync(join(root, "src/deep/b.ts"), "changed")
  writeFileSync(join(root, "src/new.ts"), "n")
  const gs = new GitStatus(root)
  await gs.start(50)
  expect(gs.enabled).toBe(true)
  expect(gs.mark(join(root, "src/deep/b.ts"))).toBe("M")
  expect(gs.mark(join(root, "src/new.ts"))).toBe("U")
  expect(gs.mark(join(root, "src/a.ts"))).toBeNull()
  expect(gs.dirMark(join(root, "src/deep"))).toBe("M")
  expect(gs.dirMark(join(root, "src"))).toBe("M") // M outranks U
  // Committing (only .git changes, which the file watcher ignores) is picked up by polling.
  let changes = 0
  gs.subscribe(() => changes++)
  git(root, "add", ".")
  git(root, "commit", "-qm", "two")
  for (let i = 0; i < 40 && gs.mark(join(root, "src/deep/b.ts")); i++) await Bun.sleep(25)
  expect(gs.mark(join(root, "src/deep/b.ts"))).toBeNull()
  expect(gs.dirMark(join(root, "src"))).toBeNull()
  expect(changes).toBeGreaterThan(0)
  gs.stop()
})

test("GitStatus outside a repo is disabled and quiet", async () => {
  const root = await fixture({ "a.txt": "a" })
  const gs = new GitStatus(root)
  await gs.start()
  expect(gs.enabled).toBe(false)
  expect(gs.mark(join(root, "a.txt"))).toBeNull()
  gs.refresh()
  gs.stop()
})

test("parseBranch reads name and ahead/behind", async () => {
  const { parseBranch } = await import("../../src/files/gitStatus")
  expect(parseBranch("## main")).toEqual({ name: "main", ahead: 0, behind: 0 })
  expect(parseBranch("## main...origin/main [ahead 2, behind 1]")).toEqual({ name: "main", ahead: 2, behind: 1 })
  expect(parseBranch("## feat/x...origin/feat/x [behind 3]")).toEqual({ name: "feat/x", ahead: 0, behind: 3 })
  expect(parseBranch("## No commits yet on master")).toEqual({ name: "master", ahead: 0, behind: 0 })
  expect(parseBranch("## HEAD (no branch)")).toEqual({ name: "detached", ahead: 0, behind: 0, detached: true })
})

test("GitStatus reports the branch", async () => {
  const root = await fixture({ "a.ts": "a" })
  git(root, "init", "-q", "-b", "trunk")
  git(root, "add", ".")
  git(root, "commit", "-qm", "init")
  const gs = new GitStatus(root)
  await gs.start(50)
  expect(gs.branch?.name).toBe("trunk")
  gs.stop()
})

test("an unchanged status doesn't wake listeners; a real change or a git operation does", async () => {
  const root = await fixture({ "a.ts": "a" })
  git(root, "init", "-q")
  git(root, "add", ".")
  git(root, "commit", "-qm", "init")
  const gs = new GitStatus(root)
  await gs.start(60_000)
  let changes = 0
  gs.subscribe(() => changes++)
  await gs.load() // e.g. the editor saving a file that was already modified
  expect(changes).toBe(0)
  writeFileSync(join(root, "a.ts"), "changed")
  await gs.load()
  expect(changes).toBe(1)
  await gs.load()
  expect(changes).toBe(1)
  await gs.afterChange() // staging or committing from the editor: contents may differ
  expect(changes).toBe(2)
  gs.stop()
})

test("GitStatus keeps the opened path's spelling when it goes through a symlink", async () => {
  const real = await fixture({ "src/a.ts": "a" })
  git(real, "init", "-q")
  git(real, "add", ".")
  git(real, "commit", "-qm", "init")
  writeFileSync(join(real, "src/a.ts"), "changed")
  const link = real + "-link"
  symlinkSync(real, link)
  const gs = new GitStatus(join(link, "src"))
  await gs.start(50)
  expect(gs.mark(join(link, "src/a.ts"))).toBe("M")
  gs.stop()
})

test("load() asked during a load waits for a fresh one, so afterChange sees the change", async () => {
  const root = await fixture({ "a.ts": "a" })
  git(root, "init", "-q")
  git(root, "add", ".")
  git(root, "commit", "-qm", "init")
  const gs = new GitStatus(root)
  await gs.start(60_000)
  const first = gs.load() // in flight: it may already have read the clean status
  writeFileSync(join(root, "a.ts"), "changed")
  await gs.afterChange()
  expect(gs.mark(join(root, "a.ts"))).toBe("M")
  await first
  gs.stop()
})
