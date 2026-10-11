import { expect, test } from "bun:test"
import { mergeTexts } from "../../src/editor/merge"

const base = "a\nb\nc\nd\ne\nf\ng\n"

test("non-overlapping edits merge", () => {
  const mine = base.replace("b\n", "B mine\n")
  const theirs = base.replace("f\n", "F theirs\n")
  expect(mergeTexts(base, mine, theirs)).toBe("a\nB mine\nc\nd\ne\nF theirs\ng\n")
})

test("overlapping edits refuse to merge", () => {
  expect(mergeTexts(base, base.replace("c\n", "mine\n"), base.replace("c\n", "theirs\n"))).toBeNull()
})

test("trivial cases", () => {
  expect(mergeTexts(base, base, "x")).toBe("x")
  expect(mergeTexts(base, "y", base)).toBe("y")
  expect(mergeTexts(base, "same", "same")).toBe("same")
})
