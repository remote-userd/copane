import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assetName, checksumFor, isNewer } from "../../src/setup/upgrade"

test("assetName matches the release archives, and is null for platforms without a build", () => {
  expect(assetName("linux", "x64")).toBe("copane-linux-x64.tar.gz")
  expect(assetName("darwin", "arm64")).toBe("copane-darwin-arm64.tar.gz")
  expect(assetName("win32", "x64")).toBeNull()
  expect(assetName("linux", "ia32")).toBeNull()
})

test("checksumFor reads sha256sum output, text or binary mode", () => {
  const sums = "aaa111  copane-linux-x64.tar.gz\nBBB222 *copane-darwin-arm64.tar.gz\n"
  expect(checksumFor(sums, "copane-linux-x64.tar.gz")).toBe("aaa111")
  expect(checksumFor(sums, "copane-darwin-arm64.tar.gz")).toBe("bbb222")
  expect(checksumFor(sums, "copane-linux-arm64.tar.gz")).toBeNull()
})

test("isNewer compares versions numerically", () => {
  expect(isNewer("v0.2.0", "0.1.0")).toBe(true)
  expect(isNewer("v0.10.0", "0.9.3")).toBe(true)
  expect(isNewer("v0.1.0", "0.1.0")).toBe(false)
  expect(isNewer("v0.1.0", "0.2.0")).toBe(false)
  expect(isNewer("v1.0", "0.9.9")).toBe(true)
})

test("--upgrade from source points to git pull, without touching the network", () => {
  const run = Bun.spawnSync(["bun", "run", "src/main.tsx", "--upgrade"], { stdout: "pipe", stdin: "ignore" })
  expect(run.exitCode).toBe(1)
  expect(run.stdout.toString()).toContain("git pull")
})

test("--install-font runs the font setup", () => {
  const dir = mkdtempSync(join(tmpdir(), "font-flag-"))
  const settings = join(dir, "settings.json")
  writeFileSync(settings, '{ "profiles": { "defaults": {}, "list": [] } }')
  const run = Bun.spawnSync(["bun", "run", "src/main.tsx", "--install-font"], {
    env: { ...process.env, CE_FONT_WT_SETTINGS: settings, CE_FONT_SKIP_INSTALL: "1", XDG_CONFIG_HOME: dir },
    stdout: "pipe",
    stdin: "ignore",
  })
  expect(run.exitCode).toBe(0)
  expect(run.stdout.toString()).toContain("default font set to")
  expect(readFileSync(settings, "utf8")).toContain("CaskaydiaMono Nerd Font")
})
