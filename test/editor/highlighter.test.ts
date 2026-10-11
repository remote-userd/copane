import { describe, expect, test } from "bun:test"
import { applyHighlights, mapHighlights, SYNTAX_HL_REF } from "../../src/editor/highlighter"

const styles: Record<string, number> = { keyword: 1, string: 2, comment: 3 }
const resolve = (g: string) => styles[g] ?? styles[g.split(".")[0]!] ?? null

describe("mapHighlights", () => {
  test("maps single-line ranges to per-line columns", () => {
    const text = "const a = 'x'\nlet b"
    const out = mapHighlights(text, [[0, 5, "keyword"], [10, 13, "string"], [14, 17, "keyword"]], resolve)
    expect(out).toEqual([
      { line: 0, start: 0, end: 5, styleId: 1 },
      { line: 0, start: 10, end: 13, styleId: 2 },
      { line: 1, start: 0, end: 3, styleId: 1 },
    ])
  })

  test("splits ranges that span lines", () => {
    const text = "/* a\nbb\nc */ x"
    const out = mapHighlights(text, [[0, 12, "comment"]], resolve)
    expect(out).toEqual([
      { line: 0, start: 0, end: 4, styleId: 3 },
      { line: 1, start: 0, end: 2, styleId: 3 },
      { line: 2, start: 0, end: 4, styleId: 3 },
    ])
  })

  test("uses display columns after wide characters", () => {
    const text = "const 日本 = 'x'"
    // "'x'" starts at string index 11; 日本 occupies 2 code units but 4 columns.
    const out = mapHighlights(text, [[11, 14, "string"]], resolve)
    expect(out).toEqual([{ line: 0, start: 13, end: 16, styleId: 2 }])
  })

  test("drops unknown groups and empty ranges, falls back to dotted prefix", () => {
    const out = mapHighlights("abc", [[0, 1, "nope"], [1, 1, "keyword"], [1, 3, "keyword.return"]], resolve)
    expect(out).toEqual([{ line: 0, start: 1, end: 3, styleId: 1 }])
  })

  test("matches the straightforward conversion on mixed text, in or out of order", () => {
    // The plain version: find the line by scanning, measure every prefix.
    const reference = (text: string, hls: [number, number, string][]) => {
      const lines = text.split("\n")
      const starts = lines.map((_, i) => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0))
      const lineOf = (idx: number) => starts.findLastIndex((s) => s <= idx)
      const col = (line: number, idx: number) => Bun.stringWidth(text.slice(starts[line], idx))
      const end = (line: number) => starts[line]! + lines[line]!.length
      const out = []
      for (const [a, b, g] of hls) {
        const styleId = resolve(g)
        if (b <= a || styleId === null) continue
        const first = lineOf(a)
        const last = lineOf(Math.max(a, b - 1))
        for (let line = first; line <= last; line++) {
          const s = line === first ? a : starts[line]!
          const e = line === last ? Math.min(b, end(line)) : end(line)
          if (e > s) out.push({ line, start: col(line, s), end: col(line, e), styleId })
        }
      }
      return out
    }
    const text = ["const 日本 = 'x' // 🎉 ok", "", "let b = `multi", "line 中 text`", "plain ascii line", "é"].join("\n")
    const groups = ["keyword", "string", "comment", "nope"]
    let seed = 7
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n)
    for (let round = 0; round < 50; round++) {
      const hls: [number, number, string][] = []
      for (let i = 0; i < 12; i++) {
        const a = rand(text.length)
        hls.push([a, a + rand(30), groups[rand(4)]!])
      }
      if (round % 2) hls.sort((x, y) => x[0] - y[0])
      expect(mapHighlights(text, hls, resolve)).toEqual(reference(text, hls))
    }
  })
})

test("applyHighlights clears the previous syntax layer first", () => {
  const calls: string[] = []
  applyHighlights(
    {
      isDestroyed: false,
      removeHighlightsByRef: (r) => calls.push(`clear:${r}`),
      addHighlight: (l, h) => calls.push(`add:${l}:${h.start}-${h.end}:${h.styleId}:${h.hlRef}`),
    },
    [{ line: 2, start: 1, end: 4, styleId: 7 }],
  )
  expect(calls).toEqual([`clear:${SYNTAX_HL_REF}`, `add:2:1-4:7:${SYNTAX_HL_REF}`])
})
