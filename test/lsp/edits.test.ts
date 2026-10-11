import { expect, test } from "bun:test"
import { applyTextEdits, workspaceEditFiles } from "../../src/lsp/edits"

const r = (l1: number, c1: number, l2: number, c2: number) => ({ start: { line: l1, character: c1 }, end: { line: l2, character: c2 } })

test("applies several edits in any order, including line-spanning ones", () => {
  const text = "const foo = 1\nfoo + foo\n"
  expect(applyTextEdits(text, [{ range: r(1, 6, 1, 9), newText: "bar" }, { range: r(0, 6, 0, 9), newText: "bar" }, { range: r(1, 0, 1, 3), newText: "bar" }])).toBe(
    "const bar = 1\nbar + bar\n",
  )
  expect(applyTextEdits("a\nb\nc", [{ range: r(0, 1, 2, 0), newText: " " }])).toBe("a c")
  expect(applyTextEdits("日本 x", [{ range: r(0, 3, 0, 4), newText: "y" }])).toBe("日本 y")
})

test("workspace edits from changes and documentChanges", () => {
  const m = workspaceEditFiles({
    changes: { "file:///a": [{ range: r(0, 0, 0, 1), newText: "x" }] },
    documentChanges: [{ textDocument: { uri: "file:///b" }, edits: [{ range: r(0, 0, 0, 0), newText: "y" }] }],
  })
  expect([...m.keys()]).toEqual(["file:///a", "file:///b"])
})

test("insideCall", async () => {
  const { insideCall } = await import("../../src/lsp/SignaturePopup")
  expect(insideCall("greet(a, ", 9)).toBe(true)
  expect(insideCall("greet(a)", 8)).toBe(false)
  expect(insideCall("f(g(1), ", 8)).toBe(true)
})

test("symbolPathAt: hierarchical and flat symbols", async () => {
  const { symbolPathAt } = await import("../../src/lsp/LspManager")
  const r = (a: number, b: number) => ({ start: { line: a, character: 0 }, end: { line: b, character: 0 } })
  const tree = [{ name: "Cart", range: r(0, 20), children: [{ name: "total", range: r(2, 5) }, { name: "add", range: r(6, 9) }] }, { name: "other", range: r(21, 30) }]
  expect(symbolPathAt(tree, { line: 3, character: 2 })).toEqual(["Cart", "total"])
  expect(symbolPathAt(tree, { line: 1, character: 0 })).toEqual(["Cart"])
  expect(symbolPathAt(tree, { line: 40, character: 0 })).toEqual([])
  const flat = [{ name: "Cart", location: { range: r(0, 20) } }, { name: "total", location: { range: r(2, 5) } }]
  expect(symbolPathAt(flat, { line: 3, character: 0 })).toEqual(["Cart", "total"])
})
