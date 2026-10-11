import { expect, test } from "bun:test"
import { changedLines, lineChanges } from "../../src/editor/changeMarkers"

const obj = (m: Map<number, string>) => Object.fromEntries(m)

test("added, modified and deleted lines", () => {
  expect(obj(lineChanges("a\nb\nc\n", "a\nb\nc\n"))).toEqual({})
  expect(obj(lineChanges("a\nb\nc\n", "a\nX\nc\n"))).toEqual({ 1: "mod" })
  expect(obj(lineChanges("a\nb\nc\n", "a\nb\nnew\nc\n"))).toEqual({ 2: "add" })
  expect(obj(lineChanges("a\nb\nc\n", "a\nc\n"))).toEqual({ 1: "del" })
  // Replace one line with two: one modified, one added.
  expect(obj(lineChanges("a\nb\nc\n", "a\nX\nY\nc\n"))).toEqual({ 1: "mod", 2: "add" })
  // Replace two lines with one: modified, then a deletion marker on the next line.
  expect(obj(lineChanges("a\nb\nc\nd\n", "a\nX\nd\n"))).toEqual({ 1: "mod", 2: "del" })
  // Deleting the end of the file marks the last line.
  expect(obj(lineChanges("a\nb\nc", "a"))).toEqual({ 0: "del" })
})

test("changedLines lists modified and added lines only", () => {
  expect(changedLines("a\nb\nc\n", "a\nX\nc\nd\n")).toEqual([1, 3])
})

test("only the changed region is diffed: same markers, and big files with small edits get them", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`)
  const base = lines.join("\n")
  const edits: [string, string][] = [
    ["at start", ["new", ...lines].join("\n")],
    ["at end", [...lines, "new"].join("\n")],
    ["middle mod", lines.map((l, i) => (i === 12 ? "X" : l)).join("\n")],
    ["middle del", lines.filter((_, i) => i !== 12).join("\n")],
    ["two places", lines.map((l, i) => (i === 3 || i === 25 ? l + "!" : l)).join("\n")],
    ["delete last", lines.slice(0, -1).join("\n")],
  ]
  const full = (x: string, y: string) => obj(lineChanges(x, y, 1e9))
  expect(obj(lineChanges(base, edits[0]![1]))).toEqual({ 0: "add" })
  expect(obj(lineChanges(base, edits[2]![1]))).toEqual({ 12: "mod" })
  expect(obj(lineChanges(base, edits[3]![1]))).toEqual({ 12: "del" })
  expect(obj(lineChanges(base, edits[4]![1]))).toEqual({ 3: "mod", 25: "mod" })
  expect(obj(lineChanges(base, edits[5]![1]))).toEqual({ 28: "del" })
  for (const [, next] of edits) expect(obj(lineChanges(base, next))).toEqual(full(base, next))
  // 50,000 lines, one edited: over the limit as a whole, but the changed region is one line.
  const huge = Array.from({ length: 50_000 }, (_, i) => `l${i}`)
  const edited = huge.map((l, i) => (i === 40_000 ? "X" : l))
  expect(obj(lineChanges(huge.join("\n"), edited.join("\n")))).toEqual({ 40000: "mod" })
})
