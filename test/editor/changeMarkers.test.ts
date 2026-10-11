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
