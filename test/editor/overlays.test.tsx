import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { join } from "node:path"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil } from "../helpers"

setDefaultTimeout(15_000)
let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})
const until = (cond: () => boolean, ms = 5000) => waitUntil(cond, ms, () => h?.setup.renderOnce())

/** Foreground and background of the cell at (x, y), as "r,g,b". */
function cell(x: number, y: number) {
  return h!.setup.renderer.currentRenderBuffer.withBuffers((c) => {
    const i = (y * c.width + x) * 4
    return { fg: Array.from(c.fg.slice(i, i + 3)).join(), bg: Array.from(c.bg.slice(i, i + 3)).join() }
  })
}

test("the word under the cursor marks its other uses without losing their syntax colour", async () => {
  const root = await fixture({ "a.ts": "export const a = 1\nexport const b = 2\n" })
  const ws = createWorkspace(root)
  await ws.buffers.open(join(root, "a.ts"))
  h = await renderApp(ws, {}, { width: 100, height: 20 })
  const second = () => h!.find("export const b")
  // Start on the "1": a word with no other uses.
  ws.buffers.active!.textarea!.setCursor(0, 17)
  ws.buffers.onCursorChange(ws.buffers.active!.id)
  // Syntax colours first: "export" and "const" are both keywords.
  await until(() => {
    const p = second()
    return cell(p.x, p.y).fg === cell(p.x + 7, p.y).fg && cell(p.x, p.y).fg !== cell(p.x + 13, p.y).fg
  })
  const plain = cell(second().x, second().y)
  ws.buffers.active!.textarea!.setCursor(0, 2) // on "export"
  ws.buffers.onCursorChange(ws.buffers.active!.id)
  await until(() => cell(second().x, second().y).bg !== plain.bg)
  const marked = cell(second().x, second().y)
  expect(marked.fg).toBe(plain.fg) // still the keyword colour
  expect(marked.bg).not.toBe(plain.bg) // with the occurrence background
  // The rest of the line is untouched.
  expect(cell(second().x + 7, second().y).bg).toBe(plain.bg)
})

test("find matches keep the syntax colour of the text they mark", async () => {
  const root = await fixture({ "a.ts": "const total = 42\nlet more = total + 42\n" })
  const ws = createWorkspace(root)
  await ws.buffers.open(join(root, "a.ts"))
  h = await renderApp(ws, {}, { width: 100, height: 20 })
  const num = () => {
    const p = h!.find("total + 42")
    return { x: p.x + 8, y: p.y }
  }
  // Numbers have their own colour; wait for syntax colouring.
  await until(() => cell(num().x, num().y).fg !== cell(num().x - 2, num().y).fg)
  const number = cell(num().x, num().y)
  ws.buffers.active!.textarea!.setCursor(0, 14) // on "42", so the find bar starts with it
  ws.buffers.onCursorChange(ws.buffers.active!.id)
  await h.step(() => h!.keys.pressKey("f", { ctrl: true }))
  await until(() => cell(num().x, num().y).bg !== number.bg)
  expect(cell(num().x, num().y).fg).toBe(number.fg) // still the number colour, with the match background
  expect(cell(num().x - 2, num().y).bg).toBe(number.bg) // "+" is no match
})
