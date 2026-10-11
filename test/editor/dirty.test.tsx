import { afterEach, expect, test } from "bun:test"
import { CodeEditorRenderable } from "../../src/editor/CodeEditorRenderable"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})

// The dirty check compares the editor's native byte size with the file's before hashing anything.
test("the ● dirty state follows typing and undo, with wide characters, in the real editor", async () => {
  const text = "héllo 日本 🎉\n\tline two\n"
  const root = await fixture({ "a.ts": text })
  const ws = createWorkspace(root)
  const buf = await ws.buffers.open("a.ts")
  ws.ui.set({ focus: "editor" })
  h = await renderApp(ws, { tree: <text>TREE</text> })
  const ta = ws.buffers.active!.textarea as CodeEditorRenderable
  expect(ta.byteSize).toBe(new TextEncoder().encode(text).length)
  expect(buf.dirty).toBe(false)
  ta.setCursor(0, 2)
  await h.step(() => h!.keys.pressKey("é"))
  expect(ta.plainText).not.toBe(text)
  expect(buf.dirty).toBe(true)
  expect(ta.byteSize).toBe(new TextEncoder().encode(ta.plainText).length)
  await h.step(() => h!.keys.pressKey("z", { ctrl: true }))
  expect(ta.plainText).toBe(text)
  expect(buf.dirty).toBe(false)
  // A same-size change (one letter for another) is still dirty.
  ta.setCursor(0, 0)
  await h.step(() => h!.keys.pressKey("\x1b[3~"))
  await h.step(() => h!.keys.pressKey("H"))
  expect(ta.plainText).toBe("Héllo 日本 🎉\n\tline two\n")
  expect(buf.dirty).toBe(true)
})
