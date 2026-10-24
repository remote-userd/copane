import { expect, test } from "bun:test"
import { indentGuides, indentUnit, matchBracket, wordOccurrences } from "../../src/editor/decorations"

test("matchBracket finds partners across lines, in both directions", () => {
  const lines = ["f(a, [1, 2]) {", "  g()", "}"]
  expect(matchBracket(lines, 0, 1)).toEqual([
    { line: 0, index: 1 },
    { line: 0, index: 11 },
  ])
  expect(matchBracket(lines, 0, 12)).toEqual([
    { line: 0, index: 11 },
    { line: 0, index: 1 },
  ]) // just after ")"
  expect(matchBracket(lines, 0, 13)).toEqual([
    { line: 0, index: 13 },
    { line: 2, index: 0 },
  ])
  expect(matchBracket(lines, 2, 0)).toEqual([
    { line: 2, index: 0 },
    { line: 0, index: 13 },
  ])
  expect(matchBracket(["(("], 0, 0)).toBeNull()
  expect(matchBracket(["abc"], 0, 1)).toBeNull()
})

test("wordOccurrences: whole words, not the one under the cursor", () => {
  const lines = ["const total = 1", "total + subtotal + total"]
  expect(wordOccurrences(lines, 0, 8)).toEqual([
    { line: 1, start: 0, end: 5 },
    { line: 1, start: 19, end: 24 },
  ])
  expect(wordOccurrences(["a = a"], 0, 0)).toEqual([]) // too short
})

test("indent unit and guides (blank lines continue the guide)", () => {
  const lines = ["a {", "  b {", "    c", "", "    d", "  }", "}"]
  expect(indentUnit(lines)).toBe(2)
  expect(indentGuides(lines, 2)).toEqual([[], [], [2], [2], [2], [], []])
  expect(indentUnit(["x", "    y"])).toBe(4)
})
