import { expect, test } from "bun:test"
import { join } from "node:path"
import { claudeArgs, conversationSaved, newClaudeSession } from "../../src/ai/claudeSession"
import { fixture } from "../helpers"

test("a claude tab gets its own conversation id, unless its args pick one", () => {
  const a = newClaudeSession("claude", [])
  const b = newClaudeSession("/usr/local/bin/claude", ["--model", "opus"])
  expect(a).toMatch(/^[0-9a-f-]{36}$/)
  expect(b).toMatch(/^[0-9a-f-]{36}$/)
  expect(a).not.toBe(b)
  for (const args of [["--continue"], ["-c"], ["--resume", "x"], ["-r"], ["--session-id", "x"], ["--resume=x"]]) expect(newClaudeSession("claude", args)).toBeUndefined()
  expect(newClaudeSession("codex", [])).toBeUndefined()
  expect(newClaudeSession("/bin/zsh", [])).toBeUndefined()
})

test("claudeArgs resumes a saved conversation, else starts it under that id", async () => {
  const id = "0b6f4c1e-1111-4222-8333-944445555666"
  const home = await fixture({ [`projects/-work-app/${id}.jsonl`]: "{}\n" })
  expect(await conversationSaved(id, home)).toBe(true)
  expect(await claudeArgs(["--model", "opus"], id, home)).toEqual(["--model", "opus", "--resume", id])
  const other = "9a9a9a9a-1111-4222-8333-944445555666"
  expect(await claudeArgs([], other, home)).toEqual(["--session-id", other])
  // No ~/.claude at all.
  expect(await claudeArgs([], id, join(home, "missing"))).toEqual(["--session-id", id])
})
