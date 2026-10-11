import { expect, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { GitRepo } from "../../src/git/repo"
import { fixture } from "../helpers"

const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_OPTIONAL_LOCKS: "0" }
const sh = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" }).stdout.toString()

/** A repo, and a worktree on its own branch where an "agent" committed one change and left two more. */
async function setup() {
  const root = await fixture({ "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n" })
  sh(root, "init", "-q", "-b", "main")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  const wt = root + "-agent"
  expect(await new GitRepo(root).addWorktree(wt, "copane/agent-1")).toBeNull()
  writeFileSync(join(wt, "a.txt"), "a by agent\n")
  sh(wt, "commit", "-qam", "agent: a")
  writeFileSync(join(wt, "b.txt"), "b by agent\n") // uncommitted
  writeFileSync(join(wt, "new.txt"), "new\n") // untracked
  return { root, wt, main: new GitRepo(root), agent: new GitRepo(wt) }
}

test("an agent's worktree changes: committed, uncommitted and untracked files, with diffs", async () => {
  const { main, agent } = await setup()
  const base = (await main.mergeBase("copane/agent-1"))!
  expect(base).toMatch(/^[0-9a-f]{40}$/)
  const changes = await agent.changesSince(base)
  expect(changes).toEqual([
    { rel: "a.txt", status: "M" },
    { rel: "b.txt", status: "M" },
    { rel: "new.txt", status: "A" },
  ])
  expect(await agent.diffSince(base, changes[0]!)).toContain("+a by agent")
  expect(await agent.diffSince(base, changes[1]!)).toContain("+b by agent")
  const added = await agent.diffSince(base, changes[2]!)
  expect(added.startsWith("@@")).toBe(true)
  expect(added).toContain("+new")
})

test("merging: the leftover work is committed, then merged; conflicts are reported", async () => {
  const { root, wt, main, agent } = await setup()
  expect(await agent.commitAll("Work from agent")).toBeNull()
  expect(await agent.commitAll("nothing left")).toBeNull() // clean: no-op
  expect(await main.merge("copane/agent-1")).toEqual({ ok: true })
  expect(await Bun.file(join(root, "b.txt")).text()).toBe("b by agent\n")
  expect(existsSync(join(root, "new.txt"))).toBe(true)
  expect(sh(root, "log", "--oneline", "-1")).toContain("Merge branch 'copane/agent-1'")

  // Both sides change c.txt: a conflict, left in the file.
  writeFileSync(join(wt, "c.txt"), "c agent\n")
  sh(wt, "commit", "-qam", "agent: c")
  writeFileSync(join(root, "c.txt"), "c mine\n")
  sh(root, "commit", "-qam", "mine: c")
  expect(await main.merge("copane/agent-1")).toEqual({ conflicts: 1 })
  expect(await Bun.file(join(root, "c.txt")).text()).toContain("<<<<<<<")
})
