import { expect, test } from "bun:test"
import { scanSymbols } from "../../src/files/symbols"

test("scanSymbols finds declarations, methods and test blocks", () => {
  const text = [
    "export async function load(a) {",
    "class Cart {",
    "  total(items: Item[]): number {",
    "    if (x) {",
    "  }",
    "}",
    "export const API = 1",
    "describe('ReactDOM', () => {",
    '  it("renders", () => {})',
    "def py_func(x):",
    "pub fn rust_fn() {",
  ].join("\n")
  expect(scanSymbols("/f", text).map((s) => `${s.line}:${s.name}`)).toEqual([
    "0:load",
    "1:Cart",
    "2:total",
    "6:API",
    "7:describe ReactDOM",
    "8:it renders",
    "9:py_func",
    "10:rust_fn",
  ])
})
