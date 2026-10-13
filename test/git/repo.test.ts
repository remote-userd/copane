import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitRepo, NOT_COMMITTED, firstError, git } from "../../src/git/repo"
import { fixture, GIT_ENV } from "../helpers"

const ENV = GIT_ENV
process.env = { ...process.env, ...ENV }

function sh(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...ENV } })
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
  return r.stdout.toString()
}

async function repoWith(files: Record<string, string>) {
  const root = await fixture(files)
  sh(root, "init", "-q", "-b", "main")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  return { root, repo: new GitRepo(root) }
}

test("status entries split staged and unstaged; stage, unstage, stage all", async () => {
  const { root, repo } = await repoWith({ "a.ts": "a\n", "b.ts": "b\n" })
  writeFileSync(join(root, "a.ts"), "a2\n")
  writeFileSync(join(root, "c.ts"), "new\n")
  let st = await repo.status()
  expect(st.map((e) => [e.rel, e.staged, e.unstaged, e.untracked])).toEqual([
    ["a.ts", false, true, false],
    ["c.ts", false, true, true],
  ])
  expect(await repo.stage([join(root, "a.ts")])).toBeNull()
  st = await repo.status()
  expect(st.find((e) => e.rel === "a.ts")).toMatchObject({ staged: true, unstaged: false })
  expect(await repo.unstage([join(root, "a.ts")])).toBeNull()
  expect((await repo.status()).find((e) => e.rel === "a.ts")).toMatchObject({ staged: false, unstaged: true })
  expect(await repo.stageAll()).toBeNull()
  expect((await repo.status()).every((e) => e.staged && !e.unstaged)).toBe(true)
})

test("setIndexText stages exact contents; commit and amend", async () => {
  const { root, repo } = await repoWith({ "a.ts": "one\ntwo\n" })
  writeFileSync(join(root, "a.ts"), "ONE\nTWO\n")
  expect(await repo.setIndexText(join(root, "a.ts"), "ONE\ntwo\n")).toBeNull()
  expect(await repo.indexText(join(root, "a.ts"))).toBe("ONE\ntwo\n")
  expect(await repo.diff(join(root, "a.ts"), true)).toContain("+ONE")
  expect(await repo.diff(join(root, "a.ts"), false)).toContain("+TWO")
  const c = await repo.commit("first change")
  expect("sha" in c && c.sha.length > 4).toBe(true)
  expect(await repo.lastMessage()).toBe("first change")
  const a = await repo.commit("first change, reworded", true)
  expect("sha" in a).toBe(true)
  expect(sh(root, "log", "--format=%s").trim().split("\n")).toEqual(["first change, reworded", "init"])
  const empty = await repo.commit("nothing")
  expect("error" in empty).toBe(true)
})

test("branches: create, list, switch; a blocked switch reports git's reason", async () => {
  const { root, repo } = await repoWith({ "a.ts": "a\n" })
  expect(await repo.createBranch("feature")).toBeNull()
  writeFileSync(join(root, "a.ts"), "feature\n")
  sh(root, "commit", "-qam", "on feature")
  expect((await repo.branches()).find((b) => b.current)?.name).toBe("feature")
  expect(await repo.switchTo("main")).toBeNull()
  writeFileSync(join(root, "a.ts"), "dirty\n")
  const err = await repo.switchTo("feature")
  expect(err).toContain("would be overwritten")
  expect((await repo.branches()).map((b) => b.name).sort()).toEqual(["feature", "main"])
})

test("blame (with unsaved contents), log and show", async () => {
  const { root, repo } = await repoWith({ "a.ts": "one\ntwo\n" })
  const blame = await repo.blame(join(root, "a.ts"), "one\nchanged\nextra\n")
  expect(blame[0]).toMatchObject({ author: "T", summary: "init" })
  expect(blame[1]!.sha).toBe(NOT_COMMITTED)
  expect(blame[2]!.sha).toBe(NOT_COMMITTED)
  writeFileSync(join(root, "a.ts"), "one\nTWO\n")
  sh(root, "commit", "-qam", "second")
  const log = await repo.log(join(root, "a.ts"))
  expect(log.map((l) => l.subject)).toEqual(["second", "init"])
  expect(await repo.show(log[0]!.sha, join(root, "a.ts"))).toContain("+TWO")
})

test("push/pull: clear errors without remote or upstream; works against a bare origin", async () => {
  const { root, repo } = await repoWith({ "a.ts": "a\n" })
  expect(await repo.push()).toMatchObject({ noRemote: true })
  const bare = mkdtempSync(join(tmpdir(), "bare-"))
  sh(bare, "init", "-q", "--bare", "-b", "main")
  sh(root, "remote", "add", "origin", bare)
  expect(await repo.push()).toMatchObject({ noUpstream: true })
  const progress: string[] = []
  expect(await repo.pushSetUpstream("main", (l) => progress.push(l))).toBeNull()
  writeFileSync(join(root, "a.ts"), "b\n")
  sh(root, "commit", "-qam", "two")
  expect(await repo.push()).toEqual({ ok: true })
  // A second clone pushes; pull fast-forwards.
  const other = mkdtempSync(join(tmpdir(), "clone-"))
  sh(other, "clone", "-q", bare, ".")
  writeFileSync(join(other, "a.ts"), "c\n")
  sh(other, "commit", "-qam", "three")
  sh(other, "push", "-q")
  expect(await repo.pull()).toBeNull()
  expect(readFileSync(join(root, "a.ts"), "utf8")).toBe("c\n")
})

test("firstError picks the fatal/error line", () => {
  expect(firstError("hint: x\nfatal: not a git repository\n")).toBe("not a git repository")
  expect(firstError("error: Your local changes would be overwritten\nAborting")).toBe("Your local changes would be overwritten")
})

// A stand-in for ssh that never answers, with a child that keeps git's pipes open.
async function hangingScript(dir: string) {
  const path = join(dir, "hang.sh")
  await Bun.write(path, "#!/bin/sh\nsleep 300 &\nsleep 300\n")
  chmodSync(path, 0o755)
  return path
}

test("a push that hangs (ssh waiting forever) ends at the timeout, children included", async () => {
  const { root } = await repoWith({ "a.ts": "a\n" })
  sh(root, "remote", "add", "origin", "ssh://nowhere.invalid/x.git")
  const ssh = await hangingScript(mkdtempSync(join(tmpdir(), "cedit-ssh-")))
  const t = performance.now()
  const r = await git(root, ["push", "origin", "main"], { timeoutMs: 500, env: { GIT_SSH_COMMAND: ssh } })
  expect(performance.now() - t).toBeLessThan(3_000)
  expect(r.ok).toBe(false)
  expect(r.err).toContain("timed out")
})

test("a commit hook that never finishes hits the timeout", async () => {
  const { root } = await repoWith({ "a.ts": "a\n" })
  const hook = join(root, ".git/hooks/pre-commit")
  await Bun.write(hook, "#!/bin/sh\nsleep 300 &\nsleep 300\n")
  chmodSync(hook, 0o755)
  writeFileSync(join(root, "a.ts"), "b\n")
  sh(root, "add", ".")
  const t = performance.now()
  const r = await git(root, ["commit", "-m", "x"], { timeoutMs: 500 })
  expect(performance.now() - t).toBeLessThan(3_000)
  expect(r.ok).toBe(false)
  expect(r.err).toContain("timed out")
})

test("staging a hunk applies autocrlf: only the changed line is staged, not every line ending", async () => {
  const { root, repo } = await repoWith({ "a.txt": "one\ntwo\nthree\n" })
  sh(root, "config", "core.autocrlf", "true")
  // A Windows checkout: CRLF in the folder, LF in git.
  writeFileSync(join(root, "a.txt"), "one\r\nTWO\r\nthree\r\n")
  expect(await repo.setIndexText(join(root, "a.txt"), "one\r\nTWO\r\nthree\r\n")).toBeNull()
  expect(await repo.indexText(join(root, "a.txt"))).toBe("one\nTWO\nthree\n")
  expect(sh(root, "diff", "--cached", "--numstat").trim()).toBe("1\t1\ta.txt")
})

test("writes fired at once run one after another: no index.lock errors", async () => {
  const files: Record<string, string> = {}
  for (let i = 0; i < 12; i++) files[`f${i}.ts`] = `${i}\n`
  const { root, repo } = await repoWith(files)
  for (let i = 0; i < 12; i++) writeFileSync(join(root, `f${i}.ts`), `changed ${i}\n`)
  const errors = await Promise.all(Object.keys(files).map((f, i) => (i % 3 === 2 ? repo.unstage([join(root, f)]) : repo.stage([join(root, f)]))))
  expect(errors.filter(Boolean)).toEqual([])
  expect((await repo.status()).filter((e) => e.staged).length).toBe(8)
})
