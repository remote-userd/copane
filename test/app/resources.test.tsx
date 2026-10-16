import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { aggregate, createResourceSampler, describeUsage, formatBytes, parseProcStat, parsePsTime, parseStatmPrivate, type ProcInfo } from "../../src/app/resources"
import { runCommand } from "../../src/keymap/commands"
import { configSchema } from "../../src/config/schema"
import { createWorkspace, fixture, renderApp, waitUntil, type Harness } from "../helpers"

setDefaultTimeout(15_000)

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})

test("/proc stat lines, names with spaces and parentheses included", () => {
  const fields = "S 1 2 3 4 5 6 7 8 9 10 250 50 0 0 20 0 9 0 100 123456 2560 18446744073709551615"
  expect(parseProcStat(`4321 (tsgo (lsp) x) ${fields}`, 4096, 100)).toEqual({
    pid: 4321,
    ppid: 1,
    name: "tsgo (lsp) x",
    cpuSec: 3,
    rss: 2560 * 4096,
  })
})

test("ps cpu times", () => {
  expect(parsePsTime("0:01.50")).toBe(1.5)
  expect(parsePsTime("01:02:03")).toBe(3723)
  expect(parsePsTime("2-00:00:10")).toBe(2 * 86400 + 10)
})

test("usage groups each child of the editor with everything under it, CPU as % of one core", () => {
  const p = (pid: number, ppid: number, name: string, mb: number, cpuSec: number): ProcInfo => ({ pid, ppid, name, rss: mb * 1024 ** 2, cpuSec })
  const procs = [p(1, 0, "init", 5, 0), p(10, 1, "bun", 200, 12), p(11, 10, "node", 300, 4), p(12, 11, "tsgo", 500, 10), p(13, 10, "claude", 100, 1)]
  const prev = new Map([[10, 11], [11, 4], [12, 8], [13, 1]])
  const u = aggregate(procs, 10, prev, 2, new Map([[11, "typescript-language-server"]]))
  expect(u.self).toEqual({ pid: 10, name: "ce", rss: 200 * 1024 ** 2, cpu: 50 })
  expect(u.children.map((c) => [c.name, formatBytes(c.rss), c.cpu])).toEqual([
    ["typescript-language-server", "800M", 100],
    ["claude", "100M", 0],
  ])
  expect(formatBytes(u.total.rss)).toBe("1.1G")
  expect(u.total.cpu).toBe(150)
  expect(describeUsage(u)).toContain("typescript-language-server")
})

test("a real sample finds this process and the children it starts", async () => {
  const child = Bun.spawn(["sleep", "5"])
  try {
    const sample = createResourceSampler()
    await sample()
    const u = await sample()
    expect(u.self.rss).toBeGreaterThan(1024 ** 2)
    expect(u.children.map((c) => c.pid)).toContain(child.pid)
  } finally {
    child.kill()
  }
})

test("the status bar shows memory and CPU; the command and the setting turn it off", async () => {
  const ws = createWorkspace(await fixture({ "a.txt": "a" }))
  h = await renderApp(ws)
  const until = (cond: () => boolean) => waitUntil(cond, 4000, () => h!.setup.renderOnce())
  await until(() => /\d+(\.\d)?[GMK] \d+%/.test(h!.frame()))
  await h.step(() => runCommand(ws, "view.toggleResources"))
  expect(h.frame()).not.toMatch(/\d+(\.\d)?[GMK] \d+%/)
  h.setup.renderer.destroy()

  const off = createWorkspace(await fixture({ "a.txt": "a" }), {}, configSchema.parse({ statusBar: { resources: false } }))
  h = await renderApp(off)
  await Bun.sleep(100)
  await h.setup.renderOnce()
  expect(h.frame()).not.toMatch(/\d+(\.\d)?[GMK] \d+%/)
  await h.step(() => runCommand(off, "view.toggleResources"))
  await until(() => /\d+(\.\d)?[GMK] \d+%/.test(h!.frame()))
})

test("private memory from statm: resident less shared pages", async () => {
  expect(parseStatmPrivate("120000 30000 10000 500 0 25000 0\n", 4096)).toBe(20000 * 4096)
  expect(parseStatmPrivate("garbage", 4096)).toBeNull()
  if (process.platform !== "linux") return
  // This process: private memory is below RSS (the bun binary's code is shared).
  const me = (await createResourceSampler()()).self.rss
  expect(me).toBeGreaterThan(0)
  expect(me).toBeLessThan(process.memoryUsage().rss)
})
