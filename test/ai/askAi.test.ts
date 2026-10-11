import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { sendChangesForReview, sendProblems } from "../../src/ai/askAi"
import { formatChangesForAgent, formatProblemsForAgent } from "../../src/ai/sendToAgent"
import type { Workspace } from "../../src/app/workspace"
import { GitStatus } from "../../src/files/gitStatus"
import type { LspManager } from "../../src/lsp/LspManager"
import { createWorkspace, fixture, GIT_ENV } from "../helpers"

/** An AI pane stand-in that records what would be typed and pasted. */
function fakeAi(ws: Workspace) {
  const sent: string[] = []
  let submitted = false
  ws.ai = { type: (t) => sent.push(t), paste: (t) => sent.push(t), submit: () => (submitted = true), focus() {}, restart() {}, kill() {} }
  return { text: () => sent.join(""), submitted: () => submitted }
}

const diag = (line: number, message: string, severity = 1, code?: number) => ({
  range: { start: { line, character: 0 }, end: { line, character: 1 } },
  severity,
  message,
  source: "ts",
  code,
})

function fakeLsp(byPath: Record<string, ReturnType<typeof diag>[]>): LspManager {
  return {
    diagnostics: (p: string) => byPath[p] ?? [],
    allDiagnostics: () => Object.entries(byPath).flatMap(([path, list]) => list.map((d) => ({ path, diag: d }))),
  } as unknown as LspManager
}

test("formatProblemsForAgent: file mentions with lines, kind, first line of the message, code", () => {
  const text = formatProblemsForAgent([
    { relPath: "src/a.ts", line: 12, severity: 1, message: "Type 'string' is not assignable to type 'number'.\n  details", source: "ts", code: 2322 },
    { relPath: "my dir/b.ts", line: 3, severity: 2, message: "Unused variable" },
  ])
  expect(text).toBe("@src/a.ts#L12 error: Type 'string' is not assignable to type 'number'. (ts 2322)\n@\"my dir/b.ts\"#L3 warning: Unused variable")
  expect(formatProblemsForAgent(Array(45).fill({ relPath: "a.ts", line: 1, severity: 1, message: "x" }))).toEndWith("…and 5 more.")
})

test("formatChangesForAgent pastes small diffs, summarises big ones, lists new files", () => {
  const small = formatChangesForAgent({ diff: "-a\n+b\n", stat: " a.ts | 2 +-", staged: true, untracked: [] })
  expect(small).toBe("The staged changes:\n```diff\n-a\n+b\n```")
  const big = formatChangesForAgent({ diff: "x".repeat(50_000), stat: " a.ts | 900 +++", staged: false, untracked: ["new.ts"] }, 40_000)
  expect(big).toContain("too big to paste")
  expect(big).toContain("git diff HEAD")
  expect(big).toContain("a.ts | 900 +++")
  expect(big).toEndWith("New files: @new.ts")
  expect(formatChangesForAgent({ diff: "", stat: "", staged: false, untracked: [] })).toBe("")
})

test("fix problems: this file's errors first, then all open files'; typed, not submitted", async () => {
  const root = await fixture({ "a.ts": "x\n", "b.ts": "y\n" })
  const ws = createWorkspace(root)
  const ai = fakeAi(ws)
  ws.lsp = fakeLsp({ [join(root, "b.ts")]: [diag(4, "Cannot find name 'q'.", 1, 2304), diag(9, "just info", 3)] })
  await ws.buffers.open(join(root, "a.ts")) // a clean file: falls back to all open files
  sendProblems(ws)
  expect(ai.text()).toBe("Fix this problem, keeping the changes minimal: @b.ts#L5 error: Cannot find name 'q'. (ts 2304)")
  expect(ai.submitted()).toBe(false)
  expect(ws.ui.get().focus).toBe("ai")
})

test("fix problems on one line (the quick-fix menu's Ask AI to fix)", async () => {
  const root = await fixture({ "a.ts": "x\n" })
  const ws = createWorkspace(root)
  const ai = fakeAi(ws)
  const a = join(root, "a.ts")
  ws.lsp = fakeLsp({ [a]: [diag(0, "first"), diag(7, "other line")] })
  sendProblems(ws, { at: { path: a, line: 0 } })
  expect(ai.text()).toContain("@a.ts#L1 error: first")
  expect(ai.text()).not.toContain("other line")
})

test("no problems: says so and sends nothing", async () => {
  const ws = createWorkspace(await fixture({}))
  const ai = fakeAi(ws)
  ws.lsp = fakeLsp({})
  sendProblems(ws)
  expect(ai.text()).toBe("")
  expect(ws.ui.get().notice?.text).toBe("No errors or warnings in open files")
})

test("review changes sends the uncommitted diff and new files from a real repo", async () => {
  const root = await fixture({ "a.ts": "one\n" })
  const env = GIT_ENV
  for (const args of [["init", "-q"], ["add", "."], ["commit", "-qm", "init"]]) Bun.spawnSync(["git", ...args], { cwd: root, env })
  writeFileSync(join(root, "a.ts"), "two\n")
  writeFileSync(join(root, "new.ts"), "fresh\n")
  const ws = createWorkspace(root)
  const ai = fakeAi(ws)
  ws.git = new GitStatus(root)
  await ws.git.start(60_000)
  await sendChangesForReview(ws)
  ws.git.stop()
  const text = ai.text()
  expect(text).toStartWith("Review these changes for bugs")
  expect(text).toContain("The uncommitted changes:")
  expect(text).toContain("-one\n+two")
  expect(text).toContain("New files: @new.ts")
  expect(ai.submitted()).toBe(false)
})
