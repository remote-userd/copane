import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { GitStatus } from "../../src/files/gitStatus"
import { GitRepo } from "../../src/git/repo"
import { fixture } from "../helpers"

const ENV = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" }

test("background status reads never make a commit fail on .git/index.lock", async () => {
  const root = await fixture({ "a.txt": "0" })
  for (const args of [["init", "-q"], ["add", "."], ["commit", "-qm", "init"]]) Bun.spawnSync(["git", ...args], { cwd: root, env: { ...process.env, ...ENV } })
  const saved = { ...process.env }
  Object.assign(process.env, ENV)
  const repo = new GitRepo(root)
  const status = new GitStatus(root)
  await status.start(60_000)
  // Status reads back to back, as the poll and file-change refreshes do in the app.
  let reading = true
  const readers = [0, 1].map(async () => {
    while (reading) {
      await repo.status()
      status.refresh(0)
      await Bun.sleep(1)
    }
  })
  const errors: string[] = []
  for (let i = 1; i <= 20; i++) {
    writeFileSync(join(root, `f${i}.txt`), String(i))
    const staged = await repo.stageAll()
    if (staged) errors.push(staged)
    const r = await repo.commit(`c${i}`)
    if ("error" in r) errors.push(r.error)
  }
  reading = false
  await Promise.all(readers)
  status.stop()
  process.env = saved
  expect(errors).toEqual([])
}, 30_000)
