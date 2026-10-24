import { expect, test } from "bun:test"
import { findAll, nearestMatch, parseGoto, replaceMatches } from "../../src/editor/search"

test("smart case and display columns", () => {
  const t = "const Foo = foo()\n日本 foo"
  expect(findAll(t, "foo").map((m) => [m.line, m.startCol])).toEqual([
    [0, 6],
    [0, 12],
    [1, 5],
  ])
  expect(findAll(t, "Foo").map((m) => [m.line, m.startCol])).toEqual([[0, 6]])
  expect(findAll(t, "")).toEqual([])
  expect(findAll("aaaa", "aa")).toHaveLength(2) // non-overlapping
})

test("nearestMatch picks the first match after the cursor and wraps", () => {
  const ms = findAll("a x\nb x\nc x", "x")
  expect(nearestMatch(ms, 1, 0)).toBe(1)
  expect(nearestMatch(ms, 2, 5)).toBe(0)
  expect(nearestMatch([], 0, 0)).toBe(-1)
})

test("replace one or all", () => {
  const t = "foo bar foo\nfoo"
  const ms = findAll(t, "foo")
  expect(replaceMatches(t, ms, "baz")).toBe("baz bar baz\nbaz")
  expect(replaceMatches(t, ms, "baz", 1)).toBe("foo bar baz\nfoo")
})

test("parseGoto", () => {
  expect(parseGoto("12", 50)).toEqual({ row: 11, col: 0 })
  expect(parseGoto(":12:4", 50)).toEqual({ row: 11, col: 3 })
  expect(parseGoto("99", 50)).toBe("Line must be 1–50")
  expect(typeof parseGoto("abc", 50)).toBe("string")
})
