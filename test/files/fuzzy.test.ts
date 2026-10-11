import { expect, test } from "bun:test"
import { fuzzyFilter, fuzzyScore } from "../../src/files/fuzzy"

const files = [
  "src/ai/AgentProcess.ts",
  "src/ai/TerminalPane.tsx",
  "src/app/App.tsx",
  "src/editor/BufferStore.ts",
  "test/editor/BufferStore.test.ts",
  "package.json",
  "README.md",
]

test("non-subsequence returns null", () => {
  expect(fuzzyScore("xyz", "src/app/App.tsx")).toBeNull()
})

test("abbreviations find the intended file first", () => {
  expect(fuzzyFilter("agproc", files)[0]?.item).toBe("src/ai/AgentProcess.ts")
  expect(fuzzyFilter("bufstore", files)[0]?.item).toBe("src/editor/BufferStore.ts")
  expect(fuzzyFilter("pkg", files)[0]?.item).toBe("package.json")
  expect(fuzzyFilter("term", files)[0]?.item).toBe("src/ai/TerminalPane.tsx")
})

test("file-name matches beat directory matches", () => {
  expect(fuzzyFilter("app", files)[0]?.item).toBe("src/app/App.tsx")
})

test("empty query returns everything", () => {
  expect(fuzzyFilter("", files)).toHaveLength(files.length)
})

test("positions point at matched characters", () => {
  const m = fuzzyScore("rdm", "README.md")!
  expect(m.positions.map((i) => "README.md"[i]!.toLowerCase()).join("")).toBe("rdm")
})
