import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { join } from "node:path"
import { MouseButtons } from "@opentui/core/testing"
import { AiReview, aiMarks } from "../../src/ai/review"
import type { Turn, TurnLog } from "../../src/ai/turns"
import { Store } from "../../src/app/store"
import { FileTree } from "../../src/files/FileTree"
import { TreeModel } from "../../src/files/TreeModel"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil } from "../helpers"

// Several waits on the UI and git per test: more room than the default 5 s.
setDefaultTimeout(15_000)

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})
const until = (cond: () => boolean | Promise<boolean>, ms = 3000) => waitUntil(cond, ms, () => h?.setup.renderOnce())

/** Just what the tree and AiReview read of a TurnLog. */
function fakeTurns() {
  const store = new Store<{ turns: Turn[] }>({ turns: [] })
  return {
    log: { store, get turns() { return store.get().turns } } as unknown as TurnLog,
    set(files: { path: string; before: string | null }[], running: boolean) {
      store.set({ turns: [{ id: 1, startedAt: 0, endedAt: running ? null : 1, prompt: "p", files: files.map((f) => ({ ...f, known: true })) }] })
    },
  }
}

const row = (name: string) => h!.lines().find((l) => l.includes(name)) ?? ""

test("the tree marks files the AI is editing (✎), then unreviewed ones (✦), and their folders", async () => {
  const root = await fixture({ "src/app.ts": "one\nAI two\nthree\n", "src/other.ts": "x\n", "readme.md": "r\n" })
  const ws = createWorkspace(root, { focus: "tree" })
  ws.review = new AiReview(ws.buffers)
  const turns = fakeTurns()
  ws.turns = turns.log
  ws.review.watch(turns.log)
  const tree = new TreeModel(root)
  await tree.load()
  await tree.expand(join(root, "src"))
  h = await renderApp(ws, { tree: <FileTree tree={tree} height={29} />, ai: <text>AI-PANE</text> })
  const app = join(root, "src/app.ts")

  // During the turn: being edited.
  turns.set([{ path: app, before: "one\ntwo\nthree\n" }], true)
  await until(() => row("app.ts").includes("✎"))
  expect(row("app.ts")).toContain("✎")
  expect(aiMarks(ws).dir(join(root, "src"))).toBe(true)
  expect(row("src")).toContain("•")
  expect(row("other.ts")).not.toContain("✦")
  expect(row("readme.md")).not.toContain("•")

  // The turn ended: still to review.
  turns.set([{ path: app, before: "one\ntwo\nthree\n" }], false)
  await until(() => row("app.ts").includes("✦"))
  expect(row("app.ts")).toContain("✦")

  // A click opens it at the AI change.
  const a = h.find("app.ts")
  await h.step(() => h!.mouse.click(a.x, a.y))
  await until(() => ws.buffers.active?.textarea?.logicalCursor.row === 1)
  expect(ws.buffers.active?.relPath).toBe(join("src", "app.ts"))
  expect(ws.buffers.active?.textarea?.logicalCursor.row).toBe(1)

  // The menu accepts it: the marks go, from the file and its folder.
  ws.ui.set({ focus: "tree" })
  await h.step(() => h!.mouse.click(a.x, a.y, MouseButtons.RIGHT))
  expect(h.frame()).toContain("Review AI Changes")
  const accept = h.find("Accept AI Changes")
  await h.step(() => h!.mouse.click(accept.x, accept.y))
  await until(() => !row("app.ts").includes("✦"))
  expect(row("app.ts")).not.toContain("✦")
  expect(aiMarks(ws).dir(join(root, "src"))).toBe(false)
})

test("Accept AI Changes in Folder clears every file under it", async () => {
  const root = await fixture({ "src/a.ts": "A\n", "src/deep/b.ts": "B\n", "top.ts": "T\n" })
  const ws = createWorkspace(root)
  ws.review = new AiReview(ws.buffers)
  const turns = fakeTurns()
  ws.review.watch(turns.log)
  turns.set(
    [
      { path: join(root, "src/a.ts"), before: "a\n" },
      { path: join(root, "src/deep/b.ts"), before: "b\n" },
      { path: join(root, "top.ts"), before: "t\n" },
    ],
    false,
  )
  expect(ws.review.acceptUnder(join(root, "src"))).toBe(2)
  expect(ws.review.files()).toEqual([join(root, "top.ts")])
})
