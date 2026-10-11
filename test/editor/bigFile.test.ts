import { afterAll, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { CodeEditorRenderable } from "../../src/editor/CodeEditorRenderable"

const { renderer } = await createTestRenderer({ width: 40, height: 10 })
afterAll(() => renderer.destroy())

test("plainText returns files over 1 MB whole (OpenTUI alone stops at 1 MB)", () => {
  const ed = new CodeEditorRenderable(renderer, { width: 40, height: 10 })
  const text = ("x".repeat(99) + "é\n").repeat(25_000) // ~2.5 MB, with multi-byte characters
  ed.setText(text)
  expect(ed.plainText).toBe(text)
  ed.setText("small")
  expect(ed.plainText).toBe("small")
})

test("line reads past 1 MB and with many bytes per character", () => {
  const ed = new CodeEditorRenderable(renderer, { width: 40, height: 10 })
  const long = "y".repeat(1_500_000)
  const family = "👨‍👩‍👧‍👦".repeat(50) + " end"
  ed.setText(`first\n${long}\n${family}\nlast`)
  expect(ed.lineText(1)).toBe(long)
  expect(ed.lineText(2)).toBe(family)
  expect(ed.lineRange(2, 3)).toEqual([family, "last"])
  expect(ed.lineText(3)).toBe("last")
  ed.setText("")
  expect(ed.plainText).toBe("")
  expect(ed.lineText(0)).toBe("")
})
