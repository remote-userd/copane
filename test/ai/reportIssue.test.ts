import { expect, test } from "bun:test"
import { join } from "node:path"
import { reportContext, reportProblem, reportPrompt, shortenPaths } from "../../src/ai/reportIssue"
import { createWorkspace } from "../../src/app/workspace"
import { fixture } from "../helpers"
import pkg from "../../package.json"

test("the facts: version, platform, terminal, and the end of the error log with private paths shortened", async () => {
  const root = await fixture({})
  const logPath = join(await fixture({}), "errors.log")
  const old = Array.from({ length: 60 }, (_, i) => `2026-10-11T10:00:${String(i).padStart(2, "0")}Z old error ${i}`).join("\n")
  await Bun.write(
    logPath,
    `${old}\n2026-10-11T11:00:00Z TypeError: boom\n    at render (/home/ann/.local/lib/x.js:1:2)\n    at open (${root}/src/a.ts:3:4)\n`,
  )
  const ws = createWorkspace(root)
  const text = await reportContext(ws, { env: { WT_SESSION: "x", TERM: "xterm-256color" }, logPath, home: "/home/ann" })
  expect(text).toContain(`copane ${pkg.version}`)
  expect(text).toContain(`OS: ${process.platform} ${process.arch}`)
  expect(text).toContain("Terminal: Windows Terminal, TERM=xterm-256color")
  expect(text).toContain("AI command: claude")
  expect(text).toContain("TypeError: boom")
  expect(text).toContain("~/.local/lib/x.js") // home shortened
  expect(text).toContain("<project>/src/a.ts") // project shortened
  expect(text).not.toContain("/home/ann")
  expect(text).not.toContain(root)
  expect(text).not.toContain("old error 0") // only the last lines
})

test("no error log: says so", async () => {
  const ws = createWorkspace(await fixture({}))
  expect(await reportContext(ws, { logPath: "/nonexistent/errors.log" })).toContain("No internal errors logged.")
})

test("the prompt: duplicates first, the draft shown, posting only after an explicit yes, a link without gh", () => {
  const p = reportPrompt("copane 1.0.0")
  expect(p).toContain("gh issue list --repo sevheng/copane --state all --search")
  expect(p).toContain("wait for my explicit yes")
  expect(p).toContain("gh issue create --repo sevheng/copane")
  expect(p).toContain("https://github.com/sevheng/copane/issues/new?title=")
  expect(p).toContain("Don't include file contents")
  expect(p).toContain("copane 1.0.0")
})

test("shortenPaths leaves text alone without a home or root to hide", () => {
  expect(shortenPaths("/a/b c", "/x", "/home/u")).toBe("/a/b c")
})

test("Report a problem types the prompt into the AI pane and goes there", async () => {
  const ws = createWorkspace(await fixture({}), { focus: "editor" })
  const pasted: string[] = []
  let focused = false
  ws.ai = {
    paste: (t) => pasted.push(t),
    type: () => {},
    submit: () => {},
    focus: () => (focused = true),
    restart: () => {},
    kill: () => {},
  }
  await reportProblem(ws)
  expect(pasted.join("")).toContain("report a problem with copane")
  expect(ws.ui.get().focus).toBe("ai")
  expect(focused).toBe(true)
  ws.ai = null
  await reportProblem(ws)
  expect(ws.ui.get().notice?.text).toContain("github.com/sevheng/copane/issues")
})
