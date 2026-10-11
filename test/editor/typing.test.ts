import { expect, test } from "bun:test"
import { deletesPair, enterText, homeIndex, typeChar } from "../../src/editor/typing"

const unit = () => "  "

test("Enter keeps the indent, adds a level after an opening bracket", () => {
  expect(enterText("    foo()", 9, unit)).toEqual({ text: "\n    ", caret: 5 })
  expect(enterText("  if (x) {", 10, unit)).toEqual({ text: "\n    ", caret: 5 })
  expect(enterText("call(", 5, unit)).toEqual({ text: "\n  ", caret: 3 })
  // Inside the leading whitespace only what is left of the cursor carries over.
  expect(enterText("    x", 2, unit)).toEqual({ text: "\n  ", caret: 3 })
})

test("Enter between a bracket pair puts the closer on its own line", () => {
  expect(enterText("  f({})", 5, unit)).toEqual({ text: "\n    \n  ", caret: 5 })
  expect(enterText("[]", 1, unit)).toEqual({ text: "\n  \n", caret: 3 })
})

test("brackets and quotes pair up, step over their closer, and stay out of words", () => {
  expect(typeChar("(", "", 0)).toBe("pair")
  expect(typeChar("(", "x)", 1)).toBe("pair")
  expect(typeChar("(", "foo", 0)).toBeNull()
  expect(typeChar(")", "f()", 2)).toBe("over")
  expect(typeChar('"', "a = ", 4)).toBe("pair")
  expect(typeChar('"', '""', 1)).toBe("over")
  expect(typeChar("'", "don", 3)).toBeNull()
  expect(typeChar("x", "", 0)).toBeNull()
})

test("Backspace removes an empty pair", () => {
  expect(deletesPair("f()", 2)).toBe(true)
  expect(deletesPair('""', 1)).toBe(true)
  expect(deletesPair("f(x)", 3)).toBe(false)
})

test("Home toggles between the first character and column 0", () => {
  expect(homeIndex("    foo", 6)).toBe(4)
  expect(homeIndex("    foo", 4)).toBe(0)
  expect(homeIndex("    foo", 0)).toBe(4)
})
