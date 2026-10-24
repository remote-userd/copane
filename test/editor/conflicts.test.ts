import { expect, test } from "bun:test"
import { conflictAt, findConflicts, resolveConflict } from "../../src/editor/conflicts"

const text = [
  "a",
  "<<<<<<< HEAD",
  "mine",
  "=======",
  "theirs",
  ">>>>>>> feature",
  "b",
  "<<<<<<< HEAD",
  "x",
  "||||||| base",
  "orig",
  "=======",
  "y",
  ">>>>>>> feature",
  "",
].join("\n")

test("finds two-way and diff3 conflicts", () => {
  expect(findConflicts(text)).toEqual([
    { start: 1, base: null, mid: 3, end: 5 },
    { start: 7, base: 9, mid: 11, end: 13 },
  ])
  expect(findConflicts("no conflicts\n")).toEqual([])
  expect(findConflicts("<<<<<<< x\nunfinished\n")).toEqual([])
})

test("accept current / incoming / both", () => {
  const [c1, c2] = findConflicts(text)
  expect(resolveConflict(text, c1!, "current").split("\n").slice(0, 3)).toEqual(["a", "mine", "b"])
  expect(resolveConflict(text, c1!, "incoming").split("\n").slice(0, 3)).toEqual(["a", "theirs", "b"])
  expect(resolveConflict(text, c1!, "both").split("\n").slice(0, 4)).toEqual(["a", "mine", "theirs", "b"])
  // diff3: the base section is dropped.
  expect(resolveConflict(text, c2!, "current").split("\n").slice(7, 9)).toEqual(["x", ""])
  expect(conflictAt(findConflicts(text), 0)).toEqual(c1)
  expect(conflictAt(findConflicts(text), 6)).toEqual(c2)
})
