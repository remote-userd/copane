import { afterEach, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { act } from "react"
import { testRender } from "@opentui/react/test-utils"
import { App } from "../../src/app/App"
import { runCommand } from "../../src/keymap/commands"
import { configSchema } from "../../src/config/schema"
import { createWorkspace, WorkspaceContext, type Workspace } from "../../src/app/workspace"

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

async function render(ws: Workspace, width: number, height: number) {
  const setup = await testRender(
    <WorkspaceContext.Provider value={ws}>
      <App slots={{ tree: <text>TREE-SLOT</text>, ai: <text>AI-SLOT</text> }} />
    </WorkspaceContext.Provider>,
    { width, height },
  )
  cleanup = () => setup.renderer.destroy()
  await setup.renderOnce()
  return setup
}

test("shell shows tree, editor placeholder, AI pane and status hints at 120x30", async () => {
  const ws = createWorkspace(process.cwd())
  const frame = (await render(ws, 120, 30)).captureCharFrame()
  expect(frame).toContain("TREE-SLOT")
  expect(frame).toContain("AI-SLOT")
  expect(frame).toContain("No file open")
  expect(frame).toContain("^P files")
})

test("narrow terminals hide the tree but keep the AI pane", async () => {
  const ws = createWorkspace(process.cwd())
  const frame = (await render(ws, 80, 24)).captureCharFrame()
  expect(frame).not.toContain("TREE-SLOT")
  expect(frame).toContain("AI-SLOT")
})

test("too-small terminals show a warning instead of the layout", async () => {
  const ws = createWorkspace(process.cwd())
  const frame = (await render(ws, 50, 10)).captureCharFrame()
  expect(frame).toContain("Terminal too small")
})

test("opened file shows its tab, gutter, contents and cursor position", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cedit-app-"))
  await writeFile(join(dir, "hello.ts"), "const x = 1\nconst y = 2\n")
  const ws = createWorkspace(dir)
  await ws.buffers.open("hello.ts")
  const setup = await render(ws, 120, 20)
  await Bun.sleep(50)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  expect(frame).toContain("hello.ts")
  expect(frame).toMatch(/1 const x = 1/)
  expect(frame).toMatch(/2 const y = 2/)
  expect(frame).toContain("Ln 1, Col 1")
  expect(frame).toContain("TypeScript")
})

test("conflict bar and dirty-quit modal render", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cedit-app-"))
  await writeFile(join(dir, "a.ts"), "v1\n")
  const ws = createWorkspace(dir)
  const buf = await ws.buffers.open("a.ts")
  const setup = await render(ws, 120, 20)
  await Bun.sleep(50)
  act(() => {
    buf.textarea!.insertText("mine ")
    ws.buffers.onContentChange(buf.id)
  })
  await writeFile(join(dir, "a.ts"), "theirs\n")
  await act(async () => {
    await ws.buffers.handleDiskChange(join(dir, "a.ts"))
  })
  await setup.renderOnce()
  const f = setup.captureCharFrame()
  expect(f).toContain("Changed on disk")
  expect(f).toContain("Compare")
  expect(f).toContain("Keep mine")
  expect(f).not.toContain("Merge both") // same line changed on both sides

  const { runCommand } = await import("../../src/keymap/commands")
  await act(async () => {
    await runCommand(ws, "app.quit")
  })
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  expect(frame).toContain("Unsaved changes")
  expect(frame).toContain("Save all and quit")
})

test("Ctrl+L after Shift+Down x2 sends exactly two lines to the AI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cedit-app-"))
  await writeFile(join(dir, "a.ts"), "line one\nline two\nline three\n")
  const ws = createWorkspace(dir)
  const typed: string[] = []
  const pasted: string[] = []
  ws.ai = { type: (t) => typed.push(t), paste: (t) => pasted.push(t), submit() {}, focus() {}, restart() {}, kill() {} }
  await ws.buffers.open("a.ts")
  const setup = await render(ws, 120, 20)
  await Bun.sleep(50)
  await act(async () => {
    await setup.mockInput.pressArrow("down", { shift: true })
    await setup.mockInput.pressArrow("down", { shift: true })
    setup.mockInput.pressKey("l", { ctrl: true })
    await Bun.sleep(20)
  })
  expect(typed).toEqual(["@a.ts#L1-2 "])
  expect(pasted).toEqual(["```\nline one\nline two\n``` "])
  expect(ws.ui.get().focus).toBe("ai")
})

test("AI actions send the context plus a request and submit it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cedit-app-"))
  await writeFile(join(dir, "a.ts"), "x\n")
  const ws = createWorkspace(dir)
  const typed: string[] = []
  let submitted = 0
  ws.ai = { type: (t) => typed.push(t), paste() {}, submit: () => submitted++, focus() {}, restart() {}, kill() {} }
  await ws.buffers.open("a.ts")
  const { runCommand, AI_ASK } = await import("../../src/keymap/commands")
  await runCommand(ws, "ai.fix")
  await Bun.sleep(200)
  expect(typed).toEqual(["@a.ts ", " " + AI_ASK.fix])
  expect(submitted).toBe(1)
  expect(ws.ui.get().focus).toBe("ai")
})

test("maximize AI: the editor stays hidden when files open, until you show it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ce-maxai-"))
  await writeFile(join(dir, "a.ts"), "const a = 1\n")
  await writeFile(join(dir, "b.ts"), "const b = 2\n")
  const ws = createWorkspace(dir, { focus: "editor" })
  await ws.buffers.open("a.ts")
  const setup = await render(ws, 120, 30)
  const aiColumn = () => setup.captureCharFrame().split("\n").find((l) => l.includes("AI-SLOT"))!.indexOf("AI-SLOT")
  const step = async (fn: () => unknown) => {
    await act(async () => void (await fn()))
    await setup.renderOnce()
  }
  expect(aiColumn()).toBeGreaterThan(30)

  // A tab is open, yet the editor goes away.
  await step(() => runCommand(ws, "view.maximizeAi"))
  expect(aiColumn()).toBe(0)
  expect(setup.captureCharFrame()).not.toContain("const a = 1")

  // Opening a file (as a tree click does) keeps it hidden, and says how to show it.
  await step(async () => {
    await ws.buffers.open("b.ts")
    ws.ui.set({ focus: "editor" })
  })
  expect(aiColumn()).toBe(0)
  expect(ws.ui.get().focus).toBe("ai")
  expect(ws.ui.get().notice?.text).toContain("Ctrl+E")

  // Ctrl+E shows it beside the AI pane; Ctrl+Alt+X hides it again; once more restores the layout.
  await step(() => runCommand(ws, "focus.editor"))
  expect(setup.captureCharFrame()).toContain("const b = 2")
  expect(aiColumn()).toBeGreaterThan(30)
  await step(() => runCommand(ws, "view.maximizeAi"))
  expect(aiColumn()).toBe(0)
  expect(ws.ui.get().aiMaximized).toEqual({ tree: true, editor: false })
  await step(() => runCommand(ws, "view.maximizeAi"))
  expect(ws.ui.get()).toMatchObject({ aiMaximized: null, treeVisible: true })
  expect(setup.captureCharFrame()).toContain("TREE-SLOT")
  expect(setup.captureCharFrame()).toContain("const b = 2")

  // Closing the last tab hides a shown editor and hands the keyboard to the AI.
  await step(() => runCommand(ws, "view.maximizeAi"))
  await step(() => runCommand(ws, "focus.editor"))
  await step(() => {
    for (const b of [...ws.buffers.list()]) ws.buffers.close(b.id)
  })
  expect(aiColumn()).toBe(0)
  expect(ws.ui.get().focus).toBe("ai")
})

test("the editor's cursor is a thin line as in VS Code, or what editor.cursorStyle says", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ce-cursor-"))
  await writeFile(join(dir, "a.ts"), "const a = 1\n")
  for (const [setting, style] of [[undefined, "line"], ["block", "block"]] as const) {
    const config = configSchema.parse(setting ? { editor: { cursorStyle: setting } } : {})
    const ws = createWorkspace(dir, { focus: "editor" }, config)
    await ws.buffers.open("a.ts")
    const setup = await render(ws, 120, 30)
    expect(ws.buffers.active!.textarea!.cursorStyle).toMatchObject({ style, blinking: true })
    setup.renderer.destroy()
    cleanup = null
  }
})
