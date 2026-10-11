import { expect, test } from "bun:test"
import { globsAllow, matcherFor, replaceAllIn, replaceInFiles, searchFiles } from "../../src/files/searchFiles"
import { fixture } from "../helpers"

const files = { "src/a.ts": "const total = 1\nfunction Total() {}\n", "src/b:odd.ts": "x total y\n", "README.md": "nothing\n" }

for (const engine of ["rg", "builtin"] as const) {
  test(`${engine}: finds matches with line, column and smart case`, async () => {
    const root = await fixture(files)
    const opts = engine === "rg" ? {} : { rg: null, files: async () => Object.keys(files) }
    if (engine === "rg" && !Bun.which("rg")) return
    const r = await searchFiles(root, "total", opts)
    expect(r.engine).toBe(engine)
    const got = r.hits.map((h) => `${h.rel}:${h.line + 1}:${h.startCol}`).sort()
    expect(got).toEqual(["src/a.ts:1:6", "src/a.ts:2:9", "src/b:odd.ts:1:2"])
    const exact = await searchFiles(root, "Total", opts)
    expect(exact.hits.map((h) => h.rel)).toEqual(["src/a.ts"])
    const capped = await searchFiles(root, "total", { ...opts, limit: 1 })
    expect(capped.hits).toHaveLength(1)
    expect(capped.truncated).toBe(true)
  })
}

const more = {
  "src/a.ts": "const totalCount = 1\nlet total = totalCount + 2\n",
  "src/a.test.ts": "expect(total).toBe(3)\n",
  "lib/b.ts": "price = $total\n",
}

for (const engine of ["rg", "builtin"] as const) {
  const optsFor = () => (engine === "rg" ? {} : { rg: null, files: async () => Object.keys(more) })

  test(`${engine}: whole word, case, regex and globs`, async () => {
    if (engine === "rg" && !Bun.which("rg")) return
    const root = await fixture(more)
    const lines = async (q: string, extra: Parameters<typeof searchFiles>[2]) =>
      (await searchFiles(root, q, { ...optsFor(), ...extra })).hits.map((h) => `${h.rel}:${h.line + 1}:${h.text.slice(h.start, h.end)}`).sort()
    expect(await lines("total", { match: { wholeWord: true } })).toEqual(["lib/b.ts:1:total", "src/a.test.ts:1:total", "src/a.ts:2:total"])
    expect(await lines("total", { match: { caseSensitive: true }, globs: ["src/**"] })).toEqual(["src/a.test.ts:1:total", "src/a.ts:1:total", "src/a.ts:2:total"])
    expect(await lines("TOTAL", { match: { caseSensitive: false }, globs: ["lib"] })).toEqual(["lib/b.ts:1:total"])
    expect(await lines("total\\w+", { match: { regex: true }, globs: ["!*.test.ts"] })).toEqual(["src/a.ts:1:totalCount", "src/a.ts:2:totalCount"])
  })

  test(`${engine}: replace in files (literal $, regex groups), every match`, async () => {
    if (engine === "rg" && !Bun.which("rg")) return
    const root = await fixture(more)
    const plan = await replaceInFiles(root, "total", "$sum", { ...optsFor(), match: { wholeWord: true }, globs: ["!lib"] })
    if (typeof plan === "string") throw new Error(plan)
    expect([...plan.keys()].map((p) => p.slice(root.length + 1)).sort()).toEqual(["src/a.test.ts", "src/a.ts"])
    expect(plan.get(`${root}/src/a.ts`)!(more["src/a.ts"])).toBe("const totalCount = 1\nlet $sum = totalCount + 2\n")

    const re = await replaceInFiles(root, "total(\\w+)", "sum$1", { ...optsFor(), match: { regex: true } })
    if (typeof re === "string") throw new Error(re)
    expect(re.get(`${root}/src/a.ts`)!(more["src/a.ts"])).toBe("const sumCount = 1\nlet total = sumCount + 2\n")
    expect(await replaceInFiles(root, "(", "x", { ...optsFor(), match: { regex: true } })).toBeTypeOf("string")
  })
}

test("matcherFor: smart case unless forced; replaceAllIn counts", () => {
  expect((matcherFor("abc") as RegExp).flags).toContain("i")
  expect((matcherFor("Abc") as RegExp).flags).not.toContain("i")
  expect((matcherFor("Abc", { caseSensitive: false }) as RegExp).flags).toContain("i")
  expect(replaceAllIn("a.b a.b", matcherFor("a.b") as RegExp, "x", false)).toEqual({ text: "x x", count: 2 })
  expect(globsAllow("src/x/y.ts", ["src"])).toBe(true)
  expect(globsAllow("src/x/y.test.ts", ["src/**", "!*.test.ts"])).toBe(false)
})
