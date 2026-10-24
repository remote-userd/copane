import { expect, test } from "bun:test"
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { TurnLog } from "../../src/ai/turns"
import { GitRepo } from "../../src/git/repo"
import { fixture, GIT_ENV } from "../helpers"

const ENV = GIT_ENV

async function repo(files: Record<string, string>, untracked: Record<string, string> = {}) {
  const root = await fixture(files)
  for (const args of [
    ["init", "-q"],
    ["add", "."],
    ["commit", "-qm", "init"],
  ])
    Bun.spawnSync(["git", ...args], { cwd: root, env: ENV })
  for (const [p, c] of Object.entries(untracked)) writeFileSync(join(root, p), c)
  const git = new GitRepo(root)
  const log = new TurnLog(
    root,
    () => git,
    async () => (await git.status()).filter((e) => e.untracked).map((e) => e.path),
  )
  const p = (rel: string) => join(root, rel)
  /** The AI writes a file, and the watcher reports it. */
  const aiWrites = async (rel: string, text: string | null) => {
    if (text === null) unlinkSync(p(rel))
    else writeFileSync(p(rel), text)
    await log.fileChanged(p(rel))
  }
  return { root, log, p, aiWrites }
}

test("a turn records each file's content before it, and undo puts all of them back", async () => {
  const { log, p, aiWrites } = await repo({ "a.ts": "one\n", "b.ts": "keep\n" }, { "notes.md": "draft\n" })
  writeFileSync(p("a.ts"), "one, edited by you\n") // uncommitted work before the turn
  await log.begin("fix the bug")
  await aiWrites("a.ts", "AI version\n")
  await aiWrites("a.ts", "AI version 2\n") // a second write keeps the first 'before'
  await aiWrites("new.ts", "created\n")
  await aiWrites("notes.md", "rewritten\n")
  await aiWrites("b.ts", null)
  await log.end()
  const [turn] = log.turns
  expect(turn!.prompt).toBe("fix the bug")
  expect(turn!.files.map((f) => [f.path.split("/").pop(), f.before, f.known])).toEqual([
    ["a.ts", "one, edited by you\n", true],
    ["new.ts", null, true],
    ["notes.md", "draft\n", true],
    ["b.ts", "keep\n", true],
  ])
  expect(await log.undo(turn!)).toBe(4)
  expect(readFileSync(p("a.ts"), "utf8")).toBe("one, edited by you\n")
  expect(existsSync(p("new.ts"))).toBe(false)
  expect(readFileSync(p("notes.md"), "utf8")).toBe("draft\n")
  expect(readFileSync(p("b.ts"), "utf8")).toBe("keep\n")
})

test("answering an approval mid-turn doesn't start a new turn; turns that change nothing are dropped", async () => {
  const { log, aiWrites } = await repo({ "a.ts": "1\n" })
  await log.begin("first")
  await log.begin("1") // the approval answer
  await aiWrites("a.ts", "2\n")
  await log.end()
  await log.begin("just a question")
  await log.end()
  expect(log.turns.map((t) => t.prompt)).toEqual(["first"])
})

test("changes outside a turn, and copane's own undo writes, are not counted", async () => {
  const { log, p, aiWrites } = await repo({ "a.ts": "1\n" })
  await aiWrites("a.ts", "you saved this\n") // no turn running
  expect(log.turns).toEqual([])
  await log.begin("change it")
  await aiWrites("a.ts", "AI\n")
  await log.end()
  await log.undo(log.turns[0]!)
  await log.begin("next")
  await log.fileChanged(p("a.ts")) // the watcher reporting the undo write
  await log.end()
  expect(log.turns).toHaveLength(1)
})

test("editedSince finds files changed after the turn; undoHunk reverts one change", async () => {
  const { log, p, aiWrites } = await repo({ "a.ts": "a\nb\nc\nd\ne\n" })
  await log.begin("two changes")
  await aiWrites("a.ts", "A\nb\nc\nd\nE\n")
  await log.end()
  const turn = log.turns[0]!
  expect(await log.editedSince(turn)).toEqual([])
  expect(await log.undoHunk(turn.files[0]!, 1)).toBe(true) // the second change (e → E)
  expect(readFileSync(p("a.ts"), "utf8")).toBe("A\nb\nc\nd\ne\n")
  expect(await log.editedSince(turn)).toEqual([p("a.ts")])
})

test("without git, an open tab's last disk text is the 'before'; otherwise it can't be undone", async () => {
  const root = await fixture({ "a.ts": "old\n", "b.ts": "x\n" })
  const log = new TurnLog(root, () => null)
  await log.begin("go")
  writeFileSync(join(root, "a.ts"), "new\n")
  await log.fileChanged(join(root, "a.ts"), "old\n")
  await log.fileChanged(join(root, "b.ts"))
  await log.end()
  expect(log.turns[0]!.files.map((f) => [f.before, f.known])).toEqual([
    ["old\n", true],
    [null, false],
  ])
})

test("in a CRLF checkout, undo writes the file back with CRLF (the repo stores LF)", async () => {
  const root = await fixture({ ".gitattributes": "*.txt text eol=crlf\n", "a.txt": "one\ntwo\n" })
  for (const args of [
    ["init", "-q"],
    ["add", "."],
    ["commit", "-qm", "init"],
  ])
    Bun.spawnSync(["git", ...args], { cwd: root, env: ENV })
  // Check out again so the working file gets CRLF, as git would on clone.
  unlinkSync(join(root, "a.txt"))
  Bun.spawnSync(["git", "checkout", "--", "a.txt"], { cwd: root, env: ENV })
  expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("one\r\ntwo\r\n")
  const git = new GitRepo(root)
  const log = new TurnLog(
    root,
    () => git,
    async () => [],
  )
  await log.begin("p")
  writeFileSync(join(root, "a.txt"), "AI\r\n")
  await log.fileChanged(join(root, "a.txt"))
  await log.end()
  expect(log.turns[0]!.files[0]!.before).toBe("one\r\ntwo\r\n")
  await log.undo(log.turns[0]!)
  expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("one\r\ntwo\r\n")
})

test("before the first commit, a staged file the AI edits is unknown, never 'new' (undo would delete it)", async () => {
  const root = await fixture({ "a.ts": "staged work\n" })
  for (const args of [
    ["init", "-q"],
    ["add", "."],
  ])
    Bun.spawnSync(["git", ...args], { cwd: root, env: ENV })
  const git = new GitRepo(root)
  const log = new TurnLog(
    root,
    () => git,
    async () => (await git.status()).filter((e) => e.untracked).map((e) => e.path),
  )
  await log.begin("p")
  writeFileSync(join(root, "a.ts"), "AI\n")
  await log.fileChanged(join(root, "a.ts"))
  await log.end()
  const f = log.turns[0]!.files[0]!
  expect(f.known).toBe(false)
  expect(await log.undo(log.turns[0]!)).toBe(0)
  expect(existsSync(join(root, "a.ts"))).toBe(true)
})
