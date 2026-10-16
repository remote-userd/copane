import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitRepos } from "../../src/git/repos"
import { TurnLog } from "../../src/ai/turns"
import { fixture, GIT_ENV } from "../helpers"

function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...GIT_ENV } })
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
  return r.stdout.toString()
}

/** A committed repository in `dir`. */
function repo(dir: string) {
  git(dir, "init", "-q", "-b", "main")
  git(dir, "add", ".")
  git(dir, "commit", "-qm", "init")
}

let repos: GitRepos | null = null
afterEach(() => {
  repos?.stop()
  repos = null
})

async function open(root: string, opts: ConstructorParameters<typeof GitRepos>[1] = {}) {
  repos = new GitRepos(root, opts)
  await repos.start(50)
  return repos
}

test("a parent folder of two repositories: both are found, and each file goes to its own", async () => {
  const root = await fixture({ "front/a.ts": "a", "back/b.ts": "b", "notes.md": "n" })
  repo(join(root, "front"))
  repo(join(root, "back"))
  writeFileSync(join(root, "front/a.ts"), "changed")
  writeFileSync(join(root, "back/new.ts"), "new")
  const r = await open(root)
  expect(r.main.enabled).toBe(false)
  expect(r.list().map((s) => r.name(s))).toEqual(["back", "front"])
  expect(r.for(join(root, "front/a.ts"))?.repo?.top).toBe(join(root, "front"))
  expect(r.for(join(root, "notes.md"))).toBeNull()
  expect(r.mark(join(root, "front/a.ts"))).toBe("M")
  expect(r.mark(join(root, "back/new.ts"))).toBe("U")
  expect(r.dirMark(join(root, "front"))).toBe("M")
  expect(await r.headText(join(root, "front/a.ts"))).toBe("a")
  // Repository actions follow the open file, unless one is picked.
  expect(r.current()?.repo?.top).toBe(join(root, "back"))
  r.pick(join(root, "front"))
  expect(r.repo?.top).toBe(join(root, "front"))
})

test("scanDepth 0 looks only at the repository the project is in", async () => {
  const root = await fixture({ "front/a.ts": "a" })
  repo(join(root, "front"))
  const r = await open(root, { scanDepth: 0 })
  expect(r.enabled).toBe(false)
})

test("a repository nested in another reports its own files; the outer one leaves it out", async () => {
  const root = await fixture({ "app.ts": "x", "lib/l.ts": "l" })
  repo(join(root, "lib"))
  repo(root) // lib shows as one untracked folder to the outer repository
  writeFileSync(join(root, "lib/l.ts"), "changed")
  const r = await open(root)
  expect(r.list().map((s) => r.name(s))).toEqual([root.split("/").pop()!, "lib"])
  expect(r.main.entries.map((e) => e.rel)).toEqual([])
  expect(r.mark(join(root, "lib/l.ts"))).toBe("M")
  expect(r.for(join(root, "lib/l.ts"))?.repo?.top).toBe(join(root, "lib"))
  expect(r.for(join(root, "app.ts"))?.repo?.top).toBe(root)
})

test("a folder with a .git file (a submodule) counts, unless detectSubmodules is off", async () => {
  const root = await fixture({ "sub/s.ts": "s" })
  const gitDir = join(mkdtempSync(join(tmpdir(), "cedit-gd-")), "sub.git")
  git(join(root, "sub"), "init", "-q", `--separate-git-dir=${gitDir}`)
  git(join(root, "sub"), "add", ".")
  git(join(root, "sub"), "commit", "-qm", "init")
  expect((await open(root)).list()).toHaveLength(1)
  repos!.stop()
  expect((await open(root, { submodules: false })).list()).toHaveLength(0)
})

test("a repository made later is found on the next scan", async () => {
  const root = await fixture({ "later/x.ts": "x" })
  const r = await open(root)
  expect(r.enabled).toBe(false)
  repo(join(root, "later"))
  await r.scan()
  expect(r.list().map((s) => r.name(s))).toEqual(["later"])
})

test("deeper repositories need a bigger scanDepth", async () => {
  const root = await fixture({ "pkgs/one/a.ts": "a" })
  repo(join(root, "pkgs/one"))
  expect((await open(root)).list()).toHaveLength(0)
  repos!.stop()
  expect((await open(root, { scanDepth: 2 })).list()).toHaveLength(1)
})

test("an AI turn's 'before' comes from the repository each file is in", async () => {
  const root = await fixture({ "front/a.ts": "front before", "back/b.ts": "back before" })
  repo(join(root, "front"))
  repo(join(root, "back"))
  const r = await open(root)
  const turns = new TurnLog(root, () => r.list().map((s) => s.repo!))
  await turns.begin("edit both")
  writeFileSync(join(root, "front/a.ts"), "front after")
  writeFileSync(join(root, "back/b.ts"), "back after")
  mkdirSync(join(root, "back/new"))
  writeFileSync(join(root, "back/new/n.ts"), "n")
  await turns.fileChanged(join(root, "front/a.ts"))
  await turns.fileChanged(join(root, "back/b.ts"))
  await turns.fileChanged(join(root, "back/new/n.ts"))
  const files = turns.turns.at(-1)!.files
  expect(Object.fromEntries(files.map((f) => [f.path.slice(root.length + 1), f.before]))).toEqual({
    "front/a.ts": "front before",
    "back/b.ts": "back before",
    "back/new/n.ts": null,
  })
})
