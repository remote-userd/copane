import { expect, test } from "bun:test"
import { applyHunk, hunkAt, hunks, nextHunk, revertHunk } from "../../src/editor/hunks"

const base = "a\nb\nc\nd\ne\nf\n"
const current = "a\nB\nc\nd\nnew\ne\n" // b→B, insert "new" before e, delete f

test("hunks: modification, insertion and deletion", () => {
  const hs = hunks(base, current)
  expect(hs.map((h) => [h.newStart, h.newLines, h.removed, h.added])).toEqual([
    [1, 1, ["b"], ["B"]],
    [4, 1, [], ["new"]],
    [6, 0, ["f"], []],
  ])
  expect(hunkAt(hs, 1)).toBe(hs[0])
  expect(hunkAt(hs, 2)).toBeUndefined()
  expect(hunkAt(hs, 6)).toBe(hs[2]) // deletion shows on the following line
  expect(nextHunk(hs, 1, 1)).toBe(hs[1])
  expect(nextHunk(hs, 6, 1)).toBe(hs[0]) // wraps
  expect(nextHunk(hs, 4, -1)).toBe(hs[0])
  expect(nextHunk(hs, 0, -1)).toBe(hs[2]) // wraps backwards
})

test("revert one hunk; stage one hunk", () => {
  const hs = hunks(base, current)
  expect(revertHunk(current, hs[0]!)).toBe("a\nb\nc\nd\nnew\ne\n")
  expect(revertHunk(current, hs[2]!)).toBe("a\nB\nc\nd\nnew\ne\nf\n")
  // Staging only the first hunk: the index gets B but not the others.
  expect(applyHunk(base, hs[0]!)).toBe("a\nB\nc\nd\ne\nf\n")
  // Index positions stay valid for later hunks too (oldStart is in base coordinates).
  expect(applyHunk(base, hs[1]!)).toBe("a\nb\nc\nd\nnew\ne\nf\n")
})
