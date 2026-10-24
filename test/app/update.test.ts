import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { takeRestoreState, watchForUpdate } from "../../src/app/update"

const tmp = () => mkdtempSync(join(tmpdir(), "cea-update-"))

test("watchForUpdate reports a replaced file once it is stable, and only once per version", async () => {
  const dir = tmp()
  const bin = join(dir, "bin")
  writeFileSync(bin, "v1")
  let hits = 0
  const stop = watchForUpdate(bin, () => hits++, 20)
  await Bun.sleep(80)
  expect(hits).toBe(0)
  // Install by rename, like scripts/install.sh.
  writeFileSync(bin + ".new", "v2 longer")
  renameSync(bin + ".new", bin)
  await Bun.sleep(120)
  expect(hits).toBe(1)
  await Bun.sleep(80)
  expect(hits).toBe(1)
  writeFileSync(bin + ".new", "v3 even longer")
  renameSync(bin + ".new", bin)
  await Bun.sleep(120)
  expect(hits).toBe(2)
  stop()
})

test("takeRestoreState reads the saved tabs once and deletes the file", async () => {
  const dir = tmp()
  const file = join(dir, "restore.json")
  writeFileSync(file, JSON.stringify({ files: ["/a.ts", "/b.ts", 3], active: "/b.ts" }))
  expect(await takeRestoreState({ CE_RESTORE_FILE: file })).toEqual({ files: ["/a.ts", "/b.ts"], active: "/b.ts" })
  expect(existsSync(file)).toBe(false)
  expect(await takeRestoreState({ CE_RESTORE_FILE: file })).toBeNull()
  expect(await takeRestoreState({})).toBeNull()
})

test("takeRestoreState brings back the project folder (ce started from the welcome page)", async () => {
  const file = join(tmp(), "restore.json")
  writeFileSync(file, JSON.stringify({ files: [], active: null, root: "/work/app" }))
  expect(await takeRestoreState({ CE_RESTORE_FILE: file })).toEqual({ files: [], active: null, root: "/work/app" })
})

test("takeRestoreState brings back the AI pane's tabs, dropping malformed ones", async () => {
  const file = join(tmp(), "restore.json")
  const claude = {
    name: "claude",
    command: "claude",
    args: [],
    cwd: "/work/app",
    branch: null,
    claudeSession: "0b6f4c1e-1111-4222-8333-944445555666",
  }
  const server = {
    name: "web",
    command: "/bin/zsh",
    args: [],
    cwd: "/work/app/web",
    branch: null,
    terminal: { run: "npm run dev" },
  }
  writeFileSync(file, JSON.stringify({ files: [], active: null, ai: { tabs: [claude, { name: 3 }, server], active: 2 } }))
  expect(await takeRestoreState({ CE_RESTORE_FILE: file })).toEqual({
    files: [],
    active: null,
    ai: { tabs: [claude, server], active: 0 },
  })
  // Nothing usable: no ai at all, and the files still come back.
  writeFileSync(file, JSON.stringify({ files: ["/a.ts"], active: null, ai: { tabs: [{ name: "x", args: "no" }], active: 0 } }))
  expect(await takeRestoreState({ CE_RESTORE_FILE: file })).toEqual({ files: ["/a.ts"], active: null })
})

test("installed launcher restarts the editor on exit code 75 and passes args through", async () => {
  const prefix = tmp()
  const inst = Bun.spawnSync(["sh", "scripts/install.sh"], {
    env: { ...process.env, PREFIX: prefix, ALIAS: "cex", FONT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(inst.exitCode).toBe(0)
  expect(readFileSync(join(prefix, "bin/copane"), "utf8")).toContain("CE_SUPERVISOR_PID")
  // Swap in a fake editor: asks for a restart twice, then exits 3. Logs each run's args.
  const log = join(prefix, "runs.log")
  writeFileSync(
    join(prefix, "lib/copane/copane"),
    `#!/bin/sh\necho "$CE_SUPERVISOR_PID $*" >> ${log}\n[ $(wc -l < ${log}) -lt 3 ] && exit 75\nexit 3\n`,
  )
  const run = Bun.spawnSync([join(prefix, "bin/cex"), "some dir", "x"], { stdout: "pipe" })
  expect(run.exitCode).toBe(3)
  const runs = readFileSync(log, "utf8").trim().split("\n")
  expect(runs).toHaveLength(3)
  expect(new Set(runs.map((r) => r.split(" ")[0])).size).toBe(1) // same supervisor each time
  expect(runs.every((r) => r.endsWith(" some dir x"))).toBe(true)
}, 30000)

test("--version prints the package version without needing a terminal", () => {
  const run = Bun.spawnSync(["bun", "run", "src/main.tsx", "--version"], { stdout: "pipe", stdin: "ignore" })
  expect(run.exitCode).toBe(0)
  expect(new TextDecoder().decode(run.stdout).trim()).toMatch(/^copane \d+\.\d+\.\d+$/)
})
