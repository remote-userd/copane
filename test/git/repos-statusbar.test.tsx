import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { join } from "node:path"
import { GitRepos } from "../../src/git/repos"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil, GIT_ENV } from "../helpers"

setDefaultTimeout(15_000)

let h: Harness | null = null
let repos: GitRepos | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  repos?.stop()
  h = repos = null
})

function repo(dir: string, branch: string) {
  for (const args of [["init", "-q", "-b", branch], ["add", "."], ["commit", "-qm", "init"]])
    Bun.spawnSync(["git", ...args], { cwd: dir, env: { ...Bun.env, ...GIT_ENV } })
}

const until = (cond: () => boolean) => waitUntil(cond, 4000, () => h?.setup.renderOnce())

async function show(root: string) {
  const ws = createWorkspace(root)
  repos = new GitRepos(root)
  await repos.start(50)
  ws.git = repos
  h = await renderApp(ws, { tree: <text>TREE</text> })
}

test("a project folder that is not a repository but holds one: the status bar shows that one's branch", async () => {
  const root = await fixture({ "app/a.ts": "a", "notes.md": "n" })
  repo(join(root, "app"), "trunk")
  await show(root)
  await until(() => h!.frame().includes("trunk"))
})

test("several repositories and no file open in one: no branch is picked at random", async () => {
  const root = await fixture({ "front/a.ts": "a", "back/b.ts": "b" })
  repo(join(root, "front"), "front-main")
  repo(join(root, "back"), "back-main")
  await show(root)
  await until(() => repos!.list().length === 2)
  h!.setup.renderOnce()
  expect(h!.frame()).not.toContain("-main")
})
