import { expect, test } from "bun:test"
import {
  commentPrefix,
  deleteLines,
  duplicateLines,
  indentLines,
  indentString,
  lineSpan,
  moveLines,
  outdentLines,
  toggleComment,
  type Sel,
} from "../../src/editor/lineOps"

const at = (row: number, index: number): Sel => ({ anchor: { row, index }, head: { row, index } })
const range = (r1: number, i1: number, r2: number, i2: number): Sel => ({ anchor: { row: r1, index: i1 }, head: { row: r2, index: i2 } })

test("lineSpan leaves out a line the selection only touches at its start", () => {
  expect(lineSpan(at(3, 2))).toEqual({ first: 3, last: 3 })
  expect(lineSpan(range(1, 0, 3, 0))).toEqual({ first: 1, last: 2 })
  expect(lineSpan(range(3, 2, 1, 4))).toEqual({ first: 1, last: 3 })
})

test("toggleComment comments at the block's smallest indent and round-trips", () => {
  const src = ["function f() {", "  if (x) {", "    y()", "", "  }", "}"]
  const sel = range(1, 2, 4, 3)
  const on = toggleComment(src, sel, "//")
  expect(on.lines).toEqual(["function f() {", "  // if (x) {", "  //   y()", "", "  // }", "}"])
  expect(on.sel).toEqual(range(1, 5, 4, 6))
  const off = toggleComment(on.lines, on.sel, "//")
  expect(off.lines).toEqual(src)
  expect(off.sel).toEqual(sel)
})

test("toggleComment comments the whole block when only some lines are commented", () => {
  const r = toggleComment(["# a", "b"], range(0, 0, 1, 1), "#")
  expect(r.lines).toEqual(["# # a", "# b"])
})

test("toggleComment removes a token with no space after it, and keeps the cursor before it", () => {
  const r = toggleComment(["  //x"], at(0, 1), "//")
  expect(r.lines).toEqual(["  x"])
  expect(r.sel).toEqual(at(0, 1))
})

test("toggleComment on a blank line starts a comment", () => {
  expect(toggleComment(["  "], at(0, 2), "//")).toEqual({ lines: ["  // "], sel: at(0, 5) })
})

test("commentPrefix knows common languages and not block-only ones", () => {
  expect(commentPrefix("typescript")).toBe("//")
  expect(commentPrefix("python")).toBe("#")
  expect(commentPrefix("lua")).toBe("--")
  expect(commentPrefix("html")).toBeNull()
  expect(commentPrefix(undefined)).toBeNull()
})

test("moveLines swaps with the neighbour and stops at the file's edges", () => {
  const src = ["a", "b", "c", "d"]
  expect(moveLines(src, range(1, 0, 2, 1), 1)).toEqual({ lines: ["a", "d", "b", "c"], sel: range(2, 0, 3, 1) })
  expect(moveLines(src, at(1, 1), -1)).toEqual({ lines: ["b", "a", "c", "d"], sel: at(0, 1) })
  expect(moveLines(src, at(0, 0), -1)).toBeNull()
  expect(moveLines(src, at(3, 0), 1)).toBeNull()
})

test("duplicateLines copies below (selection follows) or above (selection stays)", () => {
  const src = ["a", "b", "c"]
  expect(duplicateLines(src, at(1, 1), 1)).toEqual({ lines: ["a", "b", "b", "c"], sel: at(2, 1) })
  expect(duplicateLines(src, at(1, 1), -1)).toEqual({ lines: ["a", "b", "b", "c"], sel: at(1, 1) })
  expect(duplicateLines(src, range(0, 0, 2, 0), 1).lines).toEqual(["a", "b", "a", "b", "c"])
})

test("deleteLines removes the lines and clamps the cursor", () => {
  expect(deleteLines(["abc", "x", "defg"], at(0, 3))).toEqual({ lines: ["x", "defg"], sel: at(0, 1) })
  expect(deleteLines(["a", "b"], at(1, 1))).toEqual({ lines: ["a"], sel: at(0, 1) })
  expect(deleteLines(["only"], at(0, 2))).toEqual({ lines: [""], sel: at(0, 0) })
})

test("indent and outdent skip blank lines, handle tabs, and shift the selection", () => {
  const src = ["a", "", "  b"]
  const sel = range(0, 0, 2, 3)
  const ind = indentLines(src, sel, "  ")
  expect(ind).toEqual({ lines: ["  a", "", "    b"], sel: range(0, 0, 2, 5) })
  expect(outdentLines(ind.lines, ind.sel, 2)).toEqual({ lines: src, sel })
  expect(outdentLines(["\t\tx", " y"], range(0, 0, 1, 2), 4).lines).toEqual(["\tx", "y"])
})

test("indentString follows the file: tabs or its space width", () => {
  expect(indentString(["\tx", "\ty", "  z"], 2)).toBe("\t")
  expect(indentString(["    x"], 4)).toBe("    ")
})
