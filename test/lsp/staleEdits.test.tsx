import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"
import { applyFileEdits, openVersions } from "../../src/lsp/lspActions"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})

test("LSP edits for a file that changed while the server worked are skipped, not misapplied", async () => {
  const root = await fixture({ "a.ts": "let foo = 1\n", "b.ts": "foo()\n" })
  const ws = createWorkspace(root)
  const a = await ws.buffers.open("a.ts")
  const b = await ws.buffers.open("b.ts")
  h = await renderApp(ws)
  for (let i = 0; i < 50 && !(a.textarea && b.textarea); i++) (await Bun.sleep(10), await h.setup.renderOnce())
  const since = openVersions(ws) // the request goes out
  ws.buffers.replaceText(a, "// typed meanwhile\nlet foo = 1\n") // a.ts changes before the answer
  const rename = (line: number) => [{ range: { start: { line, character: 4 }, end: { line, character: 7 } }, newText: "bar" }]
  const n = await applyFileEdits(
    ws,
    new Map([
      [join(root, "a.ts"), rename(0)],
      [join(root, "b.ts"), [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: "bar" }]],
    ]),
    since,
  )
  expect(n).toBe(1)
  expect(ws.buffers.textOf(a)).toBe("// typed meanwhile\nlet foo = 1\n") // untouched, not garbled
  expect(ws.buffers.textOf(b)).toBe("bar()\n")
  expect(ws.ui.get().notice?.text).toContain("a.ts")
})
