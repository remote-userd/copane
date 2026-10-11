import { expect, test } from "bun:test"
import { AgentProcess, sessionMembers, type AgentStatus } from "../../src/ai/AgentProcess"

const decoder = new TextDecoder()

test("runs a command in a PTY with the requested size and reports exit", async () => {
  let out = ""
  const statuses: AgentStatus["kind"][] = []
  const p = new AgentProcess({
    command: "/bin/sh",
    args: ["-c", "stty size; echo done"],
    cwd: process.cwd(),
    onOutput: (d) => (out += decoder.decode(d)),
    onStatus: (s) => statuses.push(s.kind),
  })
  p.start(77, 19)
  for (let i = 0; i < 50 && p.status.kind === "running"; i++) await Bun.sleep(20)
  await Bun.sleep(50)
  expect(out).toContain("19 77")
  expect(out).toContain("done")
  expect(statuses).toEqual(["running", "exited"])
})

test("missing command reports an error instead of throwing", () => {
  const statuses: AgentStatus[] = []
  const p = new AgentProcess({
    command: "definitely-not-a-real-cli-xyz",
    cwd: process.cwd(),
    onOutput: () => {},
    onStatus: (s) => statuses.push(s),
  })
  p.start(80, 24)
  expect(statuses[0]).toEqual({ kind: "error", message: '"definitely-not-a-real-cli-xyz" not found in PATH' })
})

test("kill takes down background jobs in the CLI's session", async () => {
  const p = new AgentProcess({
    command: "/bin/sh",
    args: ["-c", "sleep 333 & sleep 334"],
    cwd: process.cwd(),
    onOutput: () => {},
  })
  p.start(80, 24)
  await Bun.sleep(200)
  const pid = p.status.kind === "running" ? p.status.pid : -1
  expect((await sessionMembers(pid)).length).toBeGreaterThanOrEqual(2)
  await p.kill(500)
  expect(await sessionMembers(pid)).toEqual([])
})
