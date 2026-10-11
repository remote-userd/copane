import { expect, test } from "bun:test"
import { bracketedPaste, formatContextForAgent } from "../../src/ai/sendToAgent"

test("file reference without selection has no snippet", () => {
  expect(formatContextForAgent("src/a.ts", null)).toEqual({ reference: "@src/a.ts ", snippet: null })
})

test("paths with spaces are quoted", () => {
  expect(formatContextForAgent("my dir/a.ts", null).reference).toBe('@"my dir/a.ts" ')
})

test("selection: line range in the reference, fenced code in the snippet", () => {
  expect(formatContextForAgent("src/a.ts", { start: 3, end: 5, text: "a\nb\nc\n" })).toEqual({
    reference: "@src/a.ts#L3-5 ",
    snippet: "```\na\nb\nc\n``` ",
  })
})

test("reference never contains a newline, so typing it cannot submit", () => {
  const { reference } = formatContextForAgent("x.md", { start: 2, end: 9, text: "l1\nl2\n" })
  expect(reference).not.toMatch(/[\r\n]/)
})

test("single-line selection and nested fences", () => {
  expect(formatContextForAgent("x.md", { start: 2, end: 2, text: "```js" })).toEqual({
    reference: "@x.md#L2 ",
    snippet: "````\n```js\n```` ",
  })
})

test("bracketed paste wraps text", () => {
  expect(bracketedPaste("hi")).toBe("\x1b[200~hi\x1b[201~")
})

import { selectionLineSpan } from "../../src/keymap/commands"

test("line span: whole lines selected with Shift+Down stop at the last full line", () => {
  expect(selectionLineSpan(0, "l1\nl2\n").end).toBe(2)
})

test("line span: partial last line counts", () => {
  expect(selectionLineSpan(4, "tail\nhead").end).toBe(6)
})

test("line span: single line", () => {
  expect(selectionLineSpan(9, "word").end).toBe(10)
})
