import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { closeModal, modalChanged, openOver } from "../../src/app/modalStack"
import { showHover } from "../../src/lsp/lspActions"
import type { Workspace } from "../../src/app/workspace"
import { createWorkspace, editorShown, fixture, renderApp, type Harness, waitUntil } from "../helpers"

// Dialogs opened from other dialogs: closing one goes back a level, never further, never less.
setDefaultTimeout(15_000)

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})
const until = (cond: () => boolean | Promise<boolean>, ms = 4000) => waitUntil(cond, ms, () => h?.setup.renderOnce())

async function open(size?: { width: number; height: number }) {
  const root = await fixture({ "a.ts": "const a = 1\n" })
  const ws = createWorkspace(root, { focus: "editor" }, editorShown())
  await ws.buffers.open("a.ts")
  h = await renderApp(ws, { tree: <text>TREE</text> }, size)
  if (!size) await until(() => !!ws.buffers.active?.textarea)
  return ws
}

test("openOver remembers the dialog under it; closeModal goes back one level at a time, at most 5 deep", () => {
  const ws = createWorkspace("/tmp")
  ws.ui.set({ modal: { kind: "help" } })
  openOver(ws, { kind: "scm" })
  openOver(ws, { kind: "branches" })
  expect(ws.ui.get().modal).toEqual({ kind: "branches", back: { kind: "scm", back: { kind: "help" } } })
  closeModal(ws)
  expect(ws.ui.get().modal).toEqual({ kind: "scm", back: { kind: "help" } })
  closeModal(ws)
  closeModal(ws)
  expect(ws.ui.get().modal).toBeNull()
  // Nothing under it: as a plain open.
  openOver(ws, { kind: "palette" })
  expect(ws.ui.get().modal).toEqual({ kind: "palette" })
  for (let i = 0; i < 10; i++) openOver(ws, { kind: "history", path: `${i}` })
  let depth = 0
  for (let m = ws.ui.get().modal; m; m = m.back ?? null) depth++
  expect(depth).toBe(5)
})

test("Compare first from the overwrite question: Escape in the diff goes back to the question", async () => {
  const ws = await open()
  const buf = ws.buffers.active!
  await h!.step(() =>
    ws.ui.set({
      modal: {
        kind: "confirm",
        title: "a.ts changed on disk",
        body: "Overwrite?",
        options: [{ key: "c", label: "Compare first", run: () => openOver(ws, { kind: "diff", bufId: buf.id }) }],
      },
    }),
  )
  await until(() => h!.frame().includes("Overwrite?"))
  await h!.step(() => h!.keys.pressKey("c"))
  await until(() => h!.frame().includes("yours (−) vs on disk (+)"))
  await h!.step(() => h!.keys.pressEscape())
  await until(() => h!.frame().includes("Overwrite?"))
  await h!.step(() => h!.keys.pressEscape())
  await until(() => ws.ui.get().modal === null)
})

test("Ctrl+Q works under a dialog: it asks about unsaved files", async () => {
  const ws = await open()
  ws.ui.set({ focus: "editor" })
  await h!.step(() => h!.keys.typeText("x"))
  await until(() => ws.buffers.hasDirty())
  await h!.step(() => h!.keys.pressKey("p", { ctrl: true }))
  await until(() => ws.ui.get().modal?.kind === "picker")
  await h!.step(() => h!.keys.pressKey("q", { ctrl: true }))
  await until(() => h!.frame().includes("Unsaved changes"))
  await h!.step(() => h!.keys.pressKey("c"))
  await until(() => ws.ui.get().modal === null)
})

test("a terminal too small to draw the dialog: Escape still closes it", async () => {
  const ws = await open({ width: 50, height: 10 })
  await h!.step(() => ws.ui.set({ modal: { kind: "help" } }))
  await until(() => h!.frame().includes("Terminal too small"))
  await h!.step(() => h!.keys.pressEscape())
  await until(() => ws.ui.get().modal === null)
})

test("a hover that arrives after you opened another dialog doesn't replace it", async () => {
  const ws = await open()
  let answer: (text: string) => void = () => {}
  // Just enough of a language server for showHover and the status bar.
  const fake = {
    hasServer: () => true,
    hover: () => new Promise<string>((r) => (answer = r)),
    diagnostics: () => [],
    status: () => "",
    counts: () => ({ errors: 0, warnings: 0 }),
  } as unknown as Workspace["lsp"]
  const hoverWith = async (meanwhile: () => void) => {
    ws.lsp = fake
    try {
      const hover = showHover(ws)
      meanwhile()
      answer("const a: number")
      await hover
    } finally {
      ws.lsp = null
    }
  }
  await hoverWith(() => ws.ui.set({ modal: { kind: "palette" } }))
  expect(ws.ui.get().modal?.kind).toBe("palette")
  // Without one opened meanwhile, it shows.
  await h!.step(() => ws.ui.set({ modal: null }))
  await until(() => !!ws.buffers.active?.textarea)
  await hoverWith(() => {})
  expect(ws.ui.get().modal?.kind).toBe("info")
  expect(modalChanged(ws, null)).toBe(true)
})
