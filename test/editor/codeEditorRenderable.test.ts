import { afterAll, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { CodeEditorRenderable, type LayerHighlight } from "../../src/editor/CodeEditorRenderable"

const { renderer, renderOnce } = await createTestRenderer({ width: 40, height: 10 })
afterAll(() => renderer.destroy())

const editor = (text: string, wrap = false) => {
  const ed = new CodeEditorRenderable(renderer, { width: 20, height: 8, wrapMode: wrap ? "char" : "none" })
  renderer.root.add(ed)
  ed.setText(text)
  return ed
}

test("getLineSources matches the full line info, with and without wrapping", async () => {
  const text = Array.from({ length: 300 }, (_, i) => (i % 7 === 0 ? "w".repeat(55) : `line ${i}`)).join("\n")
  for (const wrap of [false, true]) {
    const ed = editor(text, wrap)
    await renderOnce()
    const all = ed.lineInfo.lineSources
    for (const [start, n] of [
      [0, 8],
      [37, 9],
      [all.length - 5, 9],
    ] as const) {
      expect(ed.getLineSources(start, n)).toEqual(all.slice(start, start + n))
    }
    ed.destroy()
  }
})

const nativeOf = (ed: CodeEditorRenderable, line: number) =>
  ed
    .getLineHighlights(line)
    .map((h: { start: number; end: number; hlRef?: number | null }) => `${h.hlRef}:${h.start}-${h.end}`)
    .sort()

test("a layer update redraws changed lines and keeps other layers and plain highlights", async () => {
  const ed = editor(Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"))
  await renderOnce()
  const syntax = (shift: number, line = 3): LayerHighlight[] =>
    Array.from({ length: 50 }, (_, l) => ({ line: l, start: 0, end: l === line ? 2 + shift : 2, styleId: 1 }))
  ed.setHighlightLayer(1, syntax(0))
  ed.setHighlightLayer(2, [{ line: 3, start: 0, end: 1, styleId: 2 }])
  ed.addHighlight(3, { start: 4, end: 6, styleId: 3, hlRef: 9 })
  ed.setHighlightLayer(1, syntax(3)) // only line 3 differs
  expect(nativeOf(ed, 3)).toEqual(["1:0-5", "2:0-1", "9:4-6"])
  expect(nativeOf(ed, 4)).toEqual(["1:0-2"])
  ed.removeHighlightsByRef(9)
  ed.setHighlightLayer(1, syntax(1))
  expect(nativeOf(ed, 3)).toEqual(["1:0-3", "2:0-1"])
  ed.clearHighlightLayer(2)
  ed.setHighlightLayer(1, syntax(1, 5)) // lines 3 and 5 change
  expect(nativeOf(ed, 3)).toEqual(["1:0-2"])
  expect(nativeOf(ed, 5)).toEqual(["1:0-3"])
  ed.destroy()
})

test("lineText and lineRange read lines without the whole document", () => {
  const text = "a\tb\n日本語x\n\nlast é"
  const ed = editor(text)
  const lines = text.split("\n")
  lines.forEach((l, i) => expect(ed.lineText(i)).toBe(l))
  expect(ed.lineText(-1)).toBe("")
  expect(ed.lineText(9)).toBe("")
  expect(ed.lineRange(1, 2)).toEqual(lines.slice(1, 3))
  expect(ed.lineRange(-5, 99)).toEqual(lines)
  ed.setText("only")
  expect(ed.lineRange(0, 0)).toEqual(["only"])
  ed.destroy()
})
