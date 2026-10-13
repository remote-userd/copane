import { expect, test } from "bun:test"
import { cursorSequence, resetsCursorStyle } from "../../src/ai/cursorStyle"

const bytes = (s: string) => new TextEncoder().encode(s)

test("editor.cursorStyle maps to the terminal's blinking cursor shapes", () => {
  expect(cursorSequence("line")).toBe("\x1b[5 q")
  expect(cursorSequence("block")).toBe("\x1b[1 q")
  expect(cursorSequence("underline")).toBe("\x1b[3 q")
})

test("a reset to the default cursor shape is spotted; other shapes and text are not", () => {
  expect(resetsCursorStyle(bytes("hello\x1b[0 qworld"))).toBe(true)
  expect(resetsCursorStyle(bytes("\x1b[ q"))).toBe(true)
  expect(resetsCursorStyle(bytes("quit q \x1b[2 q"))).toBe(false)
  expect(resetsCursorStyle(bytes("q"))).toBe(false)
})
