import { afterEach, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { AiReview } from "../../src/ai/review"
import type { Turn, TurnLog } from "../../src/ai/turns"
import { Store } from "../../src/app/store"
import { BufferStore } from "../../src/editor/BufferStore"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})
async function until(cond: () => boolean, ms = 3000) {
  for (const end = Date.now() + ms; Date.now() < end && !cond(); ) {
    await Bun.sleep(25)
    await h?.setup.renderOnce()
  }
}

/** Just what AiReview reads of a TurnLog: the turns, and their store. */
function fakeTurns() {
  const store = new Store<{ turns: Turn[] }>({ turns: [] })
  let id = 1
  return {
    log: { store, get turns() { return store.get().turns } } as unknown as TurnLog,
    add(files: { path: string; before: string | null }[]) {
      const turn: Turn = { id: id++, startedAt: 0, endedAt: 1, prompt: "p", files: files.map((f) => ({ ...f, known: true })) }
      store.set({ turns: [...store.get().turns, turn] })
    },
  }
}

const lines = (n: number, edit: Record<number, string> = {}) => Array.from({ length: n }, (_, i) => edit[i] ?? `line ${i + 1}`).join("\n") + "\n"

test("the review base is the file before its first unreviewed turn; accepting takes one change at a time", async () => {
  const root = await fixture({ "a.txt": lines(10, { 1: "AI one", 7: "AI two" }) })
  const review = new AiReview(new BufferStore({ root }))
  const turns = fakeTurns()
  review.watch(turns.log)
  const path = join(root, "a.txt")
  turns.add([{ path, before: lines(10) }])
  // A later turn on the same file adds to the change; the base stays the first "before".
  turns.add([{ path, before: lines(10, { 1: "AI one" }) }])
  expect(review.files()).toEqual([path])
  expect(review.base(path)).toBe(lines(10))
  const now = (await review.textNow(path))!
  const all = review.changes(path, now)
  expect(all.map((c) => c.newStart)).toEqual([1, 7])
  review.accept(path, all[0]!)
  expect(review.changes(path, now).map((c) => c.newStart)).toEqual([7])
  review.accept(path, review.changes(path, now)[0]!)
  await until(() => !review.has(path))
  expect(review.files()).toEqual([])
})

test("a file the AI created shows as one change; files back at their base drop out", async () => {
  const root = await fixture({ "new.txt": "hello\nworld\n", "same.txt": "x\n" })
  const review = new AiReview(new BufferStore({ root }))
  const turns = fakeTurns()
  review.watch(turns.log)
  turns.add([
    { path: join(root, "new.txt"), before: null },
    { path: join(root, "same.txt"), before: "x\n" }, // changed and changed back within the turn
  ])
  expect(review.changes(join(root, "new.txt"), "hello\nworld\n")).toHaveLength(1)
  await until(() => !review.has(join(root, "same.txt")))
  expect(review.files()).toEqual([join(root, "new.txt")])
  review.acceptAll()
  expect(review.files()).toEqual([])
})

test("in the editor: violet markers and a bar; Alt+N peeks each AI change; a accepts and moves on, r undoes, then the next file", async () => {
  const root = await fixture({ "a.txt": lines(20, { 2: "AI three", 15: "AI sixteen" }), "b.txt": "b1\nAI b2\n" })
  const ws = createWorkspace(root)
  ws.review = new AiReview(ws.buffers)
  const turns = fakeTurns()
  ws.review.watch(turns.log)
  turns.add([
    { path: join(root, "a.txt"), before: lines(20) },
    { path: join(root, "b.txt"), before: "b1\nb2\n" },
  ])
  await ws.buffers.open("a.txt")
  ws.ui.set({ focus: "editor" })
  h = await renderApp(ws, { tree: <text>TREE</text> })
  const ta = ws.buffers.active!.textarea!
  await until(() => (h!.lines().find((l) => l.includes("AI three")) ?? "").includes("┃"))
  expect(h.lines().find((l) => l.includes("AI three"))).toContain("┃")
  expect(h.lines().find((l) => l.includes("line 5"))).not.toContain("┃")
  expect(h.frame()).toContain("✦ 2 AI changes (+1 file)")
  expect(h.frame()).toContain("✦ 2 to review")

  // Alt+N from the top: the first change, with the old text.
  ta.setCursor(0, 0)
  await h.step(() => h!.keys.pressKey("n", { meta: true }))
  await until(() => h!.frame().includes("AI change 1 of 2"))
  expect(ta.logicalCursor.row).toBe(2)
  expect(h.frame()).toContain("- line 3")
  expect(h.frame()).toContain("+ AI three")

  // a: accepted (the marker goes) and on to the second.
  await h.step(() => h!.keys.pressKey("a"))
  await until(() => h!.frame().includes("AI change 1 of 1"))
  expect(ta.logicalCursor.row).toBe(15)
  await until(() => !(h!.lines().find((l) => l.includes("AI three")) ?? "").includes("┃"))
  expect(h.lines().find((l) => l.includes("AI three"))).not.toContain("┃")
  expect(ta.plainText).toContain("AI three") // accepting leaves the text alone

  // r: undone in the buffer, one undo step. The file now matches its base: reviewed.
  await h.step(() => h!.keys.pressKey("r"))
  await until(() => ta.plainText.split("\n")[15] === "line 16")
  expect(ta.plainText.split("\n")[15]).toBe("line 16")
  await until(() => !ws.review!.has(join(root, "a.txt")))
  expect(ws.review.has(join(root, "a.txt"))).toBe(false)
  ta.undo() // Ctrl+Z brings the text back
  expect(ta.plainText.split("\n")[15]).toBe("AI sixteen")

  // Alt+N again: on to the other file.
  await h.step(() => h!.keys.pressKey("n", { meta: true }))
  await until(() => h!.frame().includes("AI change 1 of 1") && ws.buffers.active?.relPath === "b.txt")
  expect(ws.buffers.active?.relPath).toBe("b.txt")
  expect(h.frame()).toContain("+ AI b2")
  await h.step(() => h!.keys.pressKey("a"))
  await until(() => !ws.review!.files().length)
  expect(ws.review.files()).toEqual([])
  await until(() => !h!.frame().includes("Review Alt+N") && !h!.frame().includes("to review"))
  expect(h.frame()).not.toContain("Review Alt+N")
  expect(h.frame()).not.toContain("to review")
  expect(h.frame()).toContain("All AI changes reviewed")
})

test("Undo file puts the whole file back to its review base", async () => {
  const root = await fixture({ "a.txt": "one\nAI\nthree\nAI too\n" })
  writeFileSync(join(root, "keep.txt"), "")
  const ws = createWorkspace(root)
  ws.review = new AiReview(ws.buffers)
  const turns = fakeTurns()
  ws.review.watch(turns.log)
  turns.add([{ path: join(root, "a.txt"), before: "one\ntwo\nthree\n" }])
  await ws.buffers.open("a.txt")
  ws.ui.set({ focus: "editor" })
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await until(() => h!.frame().includes("✦ 2 AI changes"))
  const { runCommand } = await import("../../src/keymap/commands")
  await runCommand(ws, "ai.undoFile")
  const ta = ws.buffers.active!.textarea!
  expect(ta.plainText).toBe("one\ntwo\nthree\n")
  await until(() => !ws.review!.files().length)
  expect(ws.review.files()).toEqual([])
  ta.undo()
  expect(ta.plainText).toBe("one\nAI\nthree\nAI too\n")
})

test("what is left to review is remembered across restarts; files back at their base drop out", async () => {
  const root = await fixture({ "a.txt": "one\nAI\n", "b.txt": "same\n", "big.txt": "now small\n" })
  const state = join(await fixture({}), "review.json")
  const first = new AiReview(new BufferStore({ root }))
  const turns = fakeTurns()
  first.watch(turns.log)
  const save = first.persist(state, root)
  turns.add([
    { path: join(root, "a.txt"), before: "one\ntwo\n" },
    { path: join(root, "b.txt"), before: "old\n" },
    { path: join(root, "big.txt"), before: "x".repeat(1_100_000) }, // its base is too big to remember
  ])
  await save() // as on quit
  const saved = (await Bun.file(state).json()) as { files: Record<string, string> }
  expect(Object.keys(saved.files).sort()).toEqual([join(root, "a.txt"), join(root, "b.txt")])

  // b.txt went back to its base while copane was closed.
  writeFileSync(join(root, "b.txt"), "old\n")
  const next = new AiReview(new BufferStore({ root }))
  await next.load(state)
  expect(next.files()).toEqual([join(root, "a.txt")])
  expect(next.base(join(root, "a.txt"))).toBe("one\ntwo\n")

  // Nothing left: the file goes.
  const save2 = next.persist(state, root)
  next.acceptAll()
  await save2()
  expect(await Bun.file(state).exists()).toBe(false)
  // A broken file is just nothing to restore.
  writeFileSync(state, "{not json")
  const third = new AiReview(new BufferStore({ root }))
  await third.load(state)
  expect(third.files()).toEqual([])
})

test("from the AI pane: the header offers the review, Ctrl+Alt+V lands on the first change in the editor", async () => {
  const { TerminalPane } = await import("../../src/ai/TerminalPane")
  const root = await fixture({ "a.txt": "one\nAI two\nthree\n" })
  const ws = createWorkspace(root, { focus: "ai" })
  ws.review = new AiReview(ws.buffers)
  const turns = fakeTurns()
  ws.turns = turns.log
  ws.review.watch(turns.log)
  const config = { command: "/bin/sh", args: ["-c", "echo agent-ready; exec cat"], maxScrollbackBytes: 100_000, notify: "off" as const, agents: [] }
  h = await renderApp(ws, { tree: <text>TREE</text>, ai: <TerminalPane config={config} /> }, { width: 140, height: 24 })
  await until(() => h!.frame().includes("agent-ready"))
  turns.add([{ path: join(root, "a.txt"), before: "one\ntwo\nthree\n" }])
  await until(() => h!.frame().includes("✦ 1 to review"))
  expect(h.lines()[0]).toContain("✦ 1 to review") // in the AI header (the first row)

  ws.ui.set({ focus: "ai" })
  await h.step(() => h!.keys.pressKey("\x1b\x16"))
  await until(() => h!.frame().includes("AI change 1 of 1"))
  expect(ws.ui.get().focus).toBe("editor")
  expect(ws.buffers.active?.relPath).toBe("a.txt")
  expect(ws.buffers.active?.textarea?.logicalCursor.row).toBe(1)
  await h.step(() => h!.keys.pressKey("a"))
  await until(() => !h!.frame().includes("to review"))
  expect(h.frame()).not.toContain("to review")
  ws.ai?.kill()
})
