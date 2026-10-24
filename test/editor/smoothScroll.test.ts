import { afterAll, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { CodeEditorRenderable } from "../../src/editor/CodeEditorRenderable"

const { renderer, renderOnce } = await createTestRenderer({ width: 40, height: 10 })
afterAll(() => renderer.destroy())

async function editor(smooth: boolean) {
  const ed = new CodeEditorRenderable(renderer, { width: 40, height: 10 })
  renderer.root.add(ed)
  ed.smoothScroll = smooth
  ed.setText(Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n"))
  await renderOnce()
  return ed
}
const top = (ed: CodeEditorRenderable) => ed.editorView.getViewport().offsetY
const wheel = (ed: CodeEditorRenderable, direction: "up" | "down", delta = 3) =>
  ed.onMouseEvent({
    type: "scroll",
    scroll: { direction, delta },
    modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    button: 0,
    x: 1,
    y: 1,
    stopPropagation() {},
    preventDefault() {},
  } as never)
const page = (ed: CodeEditorRenderable) =>
  ed.handleKeyPress({ name: "pagedown", ctrl: false, meta: false, shift: false, option: false, sequence: "\x1b[6~" } as never)

test("a wheel step glides: part of the way at once, the rest over the next frames", async () => {
  const ed = await editor(true)
  wheel(ed, "down", 9)
  const first = top(ed)
  expect(first).toBeGreaterThan(0)
  expect(first).toBeLessThan(9)
  await Bun.sleep(200)
  expect(top(ed)).toBe(9)
  ed.destroy()
})

test("wheel steps during a glide add up instead of restarting", async () => {
  const ed = await editor(true)
  wheel(ed, "down", 3)
  wheel(ed, "down", 3)
  wheel(ed, "down", 3)
  await Bun.sleep(250)
  expect(top(ed)).toBe(9)
  ed.destroy()
})

test("PageDown glides the cursor and the view together, ending one screen down", async () => {
  const ed = await editor(true)
  ed.setCursor(2, 0)
  page(ed)
  expect(top(ed)).toBeLessThan(9) // still on its way
  await Bun.sleep(250)
  expect(top(ed)).toBe(9)
  expect(ed.logicalCursor.row).toBe(11)
  ed.destroy()
})

test("a key stops the glide where it is", async () => {
  const ed = await editor(true)
  wheel(ed, "down", 60)
  ed.handleKeyPress({ name: "right", ctrl: false, meta: false, shift: false, option: false, sequence: "\x1b[C" } as never)
  const stopped = top(ed)
  await Bun.sleep(150)
  expect(top(ed)).toBeLessThanOrEqual(stopped)
  expect(stopped).toBeLessThan(60)
  ed.destroy()
})

test("with smoothScrolling off, scrolling jumps at once", async () => {
  const ed = await editor(false)
  wheel(ed, "down", 9)
  expect(top(ed)).toBe(9)
  ed.setCursor(top(ed) + 2, 0)
  page(ed)
  expect(top(ed)).toBe(18)
  ed.destroy()
})
