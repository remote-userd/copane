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

test("several repositories and no file open in one: the status bar counts them, and its menu opens one in Source control", async () => {
  const root = await fixture({ "front/a.ts": "a", "back/b.ts": "b" })
  repo(join(root, "front"), "front-main")
  repo(join(root, "back"), "back-main")
  await Bun.write(join(root, "front/new.ts"), "n")
  await show(root)
  await until(() => h!.frame().includes("2 repos ● 1"))
  // No branch picked at random.
  expect(h!.frame()).not.toContain("-main")
  const at = h!.find("2 repos")
  await h!.step(() => h!.mouse.click(at.x, at.y))
  await until(() => h!.frame().includes("front  front-main"))
  expect(h!.frame()).toContain("back   back-main")
  // The menu sits above the status bar.
  expect(h!.find("front  front-main").y).toBeLessThan(at.y)
  await h!.step(() => h!.keys.pressArrow("down"))
  await h!.step(() => h!.keys.pressEnter())
  await until(() => h!.frame().includes("Source control  front"))
})
